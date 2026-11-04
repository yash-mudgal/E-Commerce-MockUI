import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as backup from "aws-cdk-lib/aws-backup";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as events from "aws-cdk-lib/aws-events";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { EnvConfig } from "./config";

export interface CoreStackProps extends StackProps {
  config: EnvConfig;
  webAclArn: string;
  drVaultArn: string;
}

/** Header CloudFront adds to every origin request; the load balancer refuses requests without it. */
export const ORIGIN_HEADER = "X-ShopMint-Origin";
/** Header the edge function sets to the viewer's IP (the API's Proxy:ClientIpHeader). */
export const CLIENT_IP_HEADER = "X-ShopMint-Client-Ip";
export const INTERNAL_NAMESPACE = "shopmint.internal";

/**
 * Availability SLO (docs/SLO.md): 99.9% of requests over 30 days don't fail with a 5xx, leaving an error budget of
 * 0.1%. Burn-rate alarms page when the budget is being spent much faster than it accrues, using a long window to
 * show it's real and a short window to show it's still happening (the multi-window approach of the Google SRE
 * workbook): 14.4× over 1 hour (2% of the monthly budget gone) and 6× over 6 hours (5% gone).
 */
export const SLO = { availability: 99.9, fastBurn: { rate: 14.4, long: 60, short: 5 }, slowBurn: { rate: 6, long: 360, short: 30 } } as const;

/**
 * Edge function on every dynamic request:
 *  - /internal/* (cache refresh hook, health) is never reachable from the internet;
 *  - X-Forwarded-Host from the browser is dropped, so a store host can't be spoofed through the API;
 *  - the viewer's IP is written to CLIENT_IP_HEADER (overwriting anything the browser sent) for the API's rate limits.
 */
export const EDGE_FUNCTION_CODE = `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('/internal/') === 0) {
    return { statusCode: 404, statusDescription: 'Not Found', headers: { 'cache-control': { value: 'no-store' } } };
  }
  delete request.headers['x-forwarded-host'];
  request.headers['${CLIENT_IP_HEADER.toLowerCase()}'] = { value: event.viewer.ip };
  return request;
}`;

/**
 * Long-lived resources for one environment: network, database, secrets, media storage and CDN, ECS cluster, load
 * balancer and app CDN, backups and the alarm topic. Releases don't change this stack (see MigrateStack and
 * ServicesStack), so a bad release can't touch data.
 */
export class CoreStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly namespace: servicediscovery.PrivateDnsNamespace;
  readonly apiSecurityGroup: ec2.SecurityGroup;
  readonly webSecurityGroup: ec2.SecurityGroup;
  readonly database: rds.DatabaseInstance;
  readonly dbPasswords: Record<"owner" | "app" | "platform", secretsmanager.Secret>;
  readonly appSecret: secretsmanager.ISecret;
  readonly revalidateSecret: secretsmanager.Secret;
  readonly originSecret: secretsmanager.Secret;
  readonly mediaBucket: s3.Bucket;
  readonly listener: elbv2.ApplicationListener;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly alarmTopic: sns.Topic;
  readonly logGroups: Record<"api" | "web" | "migrate", logs.LogGroup>;
  readonly distribution: cloudfront.Distribution;
  /** 5xx share of requests over a window, in percent (for dashboards). */
  readonly errorRate: (minutes: number) => cloudwatch.MathExpression;

  private readonly zones: string[];

  /** Explicit zones: no account lookup at synth time, and the subnet layout never shifts between deploys. */
  override get availabilityZones(): string[] {
    return this.zones;
  }

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);
    const { config } = props;
    this.zones = ["a", "b", "c"].slice(0, config.maxAzs).map((z) => `${config.region}${z}`);
    const prod = config.name === "production";
    const retain = prod ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT;

    // ---------- Network ----------
    this.vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr(config.vpcCidr),
      availabilityZones: this.availabilityZones,
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: { s3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
      flowLogs: {
        rejected: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(new logs.LogGroup(this, "FlowLogs", {
            retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY,
          })),
          trafficType: ec2.FlowLogTrafficType.REJECT,
        },
      },
    });

    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc: this.vpc, description: "Load balancer: HTTPS from CloudFront only", allowAllOutbound: false });
    albSg.addIngressRule(ec2.Peer.prefixList(config.cloudFrontPrefixListId), ec2.Port.tcp(443), "CloudFront origin-facing");
    this.apiSecurityGroup = new ec2.SecurityGroup(this, "ApiSg", { vpc: this.vpc, description: "API tasks and one-off jobs" });
    this.webSecurityGroup = new ec2.SecurityGroup(this, "WebSg", { vpc: this.vpc, description: "Web (Next.js) tasks" });
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc: this.vpc, description: "PostgreSQL", allowAllOutbound: false });
    this.apiSecurityGroup.addIngressRule(albSg, ec2.Port.tcp(8080), "Load balancer to API");
    this.apiSecurityGroup.addIngressRule(this.webSecurityGroup, ec2.Port.tcp(8080), "Server-side rendering calls the API");
    this.webSecurityGroup.addIngressRule(albSg, ec2.Port.tcp(3000), "Load balancer to web");
    this.webSecurityGroup.addIngressRule(this.apiSecurityGroup, ec2.Port.tcp(3000), "API refreshes cached storefront pages");
    dbSg.addIngressRule(this.apiSecurityGroup, ec2.Port.tcp(5432), "API and migrations");
    albSg.addEgressRule(this.apiSecurityGroup, ec2.Port.tcp(8080));
    albSg.addEgressRule(this.webSecurityGroup, ec2.Port.tcp(3000));

    // ---------- Alarms ----------
    this.alarmTopic = new sns.Topic(this, "Alarms", { displayName: `ShopMint ${config.name} alarms` });
    this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
    const alarm = (a: cloudwatch.Alarm) => {
      a.addAlarmAction(new cwActions.SnsAction(this.alarmTopic));
      a.addOkAction(new cwActions.SnsAction(this.alarmTopic));
      return a;
    };

    // ---------- Database ----------
    const generated = (name: string, description: string) => new secretsmanager.Secret(this, name, {
      description,
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "password", passwordLength: 40, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.dbPasswords = {
      owner: generated("DbOwnerPassword", "shopmint_owner (migrations)"),
      app: generated("DbAppPassword", "shopmint_app (request path, row-level security)"),
      platform: generated("DbPlatformPassword", "shopmint_platform (platform console, jobs)"),
    };

    const parameters = new rds.ParameterGroup(this, "DbParams", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_13 }),
      parameters: {
        "rds.force_ssl": "1",
        "log_min_duration_statement": "500",
        "log_lock_waits": "1",
        "shared_preload_libraries": "pg_stat_statements",
        "idle_in_transaction_session_timeout": "60000",
      },
    });
    this.database = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_13 }),
      instanceType: new ec2.InstanceType(config.db.instanceType),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret("shopmint_master"),
      parameterGroup: parameters,
      multiAz: config.db.multiAz,
      allocatedStorage: config.db.allocatedStorageGiB,
      maxAllocatedStorage: config.db.maxAllocatedStorageGiB,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: Duration.days(config.db.backupRetentionDays),
      preferredBackupWindow: "20:00-21:00", // 01:30–02:30 IST
      preferredMaintenanceWindow: "sun:21:30-sun:22:30",
      deletionProtection: config.db.deletionProtection,
      removalPolicy: retain,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: true,
      monitoringInterval: Duration.seconds(60),
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: config.logRetentionDays as logs.RetentionDays,
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      publiclyAccessible: false,
    });
    alarm(new cloudwatch.Alarm(this, "DbCpu", {
      metric: this.database.metricCPUUtilization({ period: Duration.minutes(5) }),
      threshold: 80, evaluationPeriods: 3, alarmDescription: "Database CPU above 80% for 15 minutes",
    }));
    alarm(new cloudwatch.Alarm(this, "DbFreeStorage", {
      metric: this.database.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      threshold: 10 * 1024 ** 3, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD, evaluationPeriods: 1,
      alarmDescription: "Database free storage below 10 GiB (autoscaling storage may be at its maximum)",
    }));
    alarm(new cloudwatch.Alarm(this, "DbConnections", {
      metric: this.database.metricDatabaseConnections({ period: Duration.minutes(5) }),
      threshold: prod ? 600 : 150, evaluationPeriods: 2,
      alarmDescription: "Many database connections: check pool sizes (Database:MaxPoolSize) × tasks",
    }));
    alarm(new cloudwatch.Alarm(this, "DbMemory", {
      metric: this.database.metricFreeableMemory({ period: Duration.minutes(5) }),
      threshold: 256 * 1024 ** 2, comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD, evaluationPeriods: 3,
      alarmDescription: "Database freeable memory below 256 MiB",
    }));

    // ---------- Application secrets ----------
    // Filled in by an operator once (docs/runbooks/first-deploy.md), never by CDK, so a deploy can't overwrite them:
    // paymentsSecretsKey, billingRazorpayKeyId, billingRazorpayKeySecret, billingRazorpayWebhookSecret, smtpUsername,
    // smtpPassword.
    this.appSecret = secretsmanager.Secret.fromSecretNameV2(this, "AppSecret", `shopmint/${config.name}/app`);
    this.revalidateSecret = new secretsmanager.Secret(this, "RevalidateSecret", {
      description: "Shared by the API and web tasks for storefront cache refreshes",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    this.originSecret = new secretsmanager.Secret(this, "OriginSecret", {
      description: "CloudFront adds it to origin requests; the load balancer refuses requests without it",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    // ---------- Media (product images) ----------
    this.mediaBucket = new s3.Bucket(this, "Media", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { id: "old-versions", noncurrentVersionExpiration: Duration.days(30) },
        { id: "abandoned-multipart", abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      cors: [{
        // Browsers upload with presigned PUTs from the app and from storefront admin pages.
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: [`https://${config.appDomain}`],
        allowedHeaders: ["Content-Type"],
        maxAge: 3000,
      }],
    });
    const globalCert = acm.Certificate.fromCertificateArn(this, "GlobalCert", config.certificateArnGlobal);
    const mediaCdn = new cloudfront.Distribution(this, "MediaCdn", {
      comment: `ShopMint ${config.name} media`,
      domainNames: [config.mediaDomain],
      certificate: globalCert,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.mediaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, "MediaHeaders", {
          securityHeadersBehavior: {
            contentTypeOptions: { override: true },
            strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, override: true },
          },
          customHeadersBehavior: { customHeaders: [{ header: "Cross-Origin-Resource-Policy", value: "cross-origin", override: true }] },
        }),
      },
    });

    // ---------- Compute ----------
    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: this.vpc,
      clusterName: `shopmint-${config.name}`,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });
    this.namespace = new servicediscovery.PrivateDnsNamespace(this, "Namespace", { name: INTERNAL_NAMESPACE, vpc: this.vpc });
    const logGroup = (name: string) => new logs.LogGroup(this, `${name}Logs`, {
      logGroupName: `/shopmint/${config.name}/${name}`,
      retention: config.logRetentionDays as logs.RetentionDays,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.logGroups = { api: logGroup("api"), web: logGroup("web"), migrate: logGroup("migrate") };

    // ---------- Load balancer (origin) ----------
    const albLogs = new s3.Bucket(this, "AlbLogs", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(config.logRetentionDays) }],
    });
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
      idleTimeout: Duration.seconds(60),
      deletionProtection: prod,
    });
    this.loadBalancer.logAccessLogs(albLogs, "alb");
    this.listener = this.loadBalancer.addListener("Https", {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      certificates: [elbv2.ListenerCertificate.fromArn(config.certificateArnRegional)],
      open: false,
      // Requests that didn't come through CloudFront (no origin header) end here.
      defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: "text/plain", messageBody: "Forbidden" }),
    });
    // Share of requests that failed with a 5xx (load balancer or targets) over a window, in percent.
    const errorRate = (minutes: number) => new cloudwatch.MathExpression({
      expression: "100 * (e5 + t5) / MAX([req, 1])",
      period: Duration.minutes(minutes),
      usingMetrics: {
        e5: this.loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: Duration.minutes(minutes), statistic: "Sum" }),
        t5: this.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(minutes), statistic: "Sum" }),
        req: this.loadBalancer.metrics.requestCount({ period: Duration.minutes(minutes), statistic: "Sum" }),
      },
      label: `5xx % over ${minutes} min`,
    });
    this.errorRate = errorRate;
    const budgetPct = 100 - SLO.availability;
    for (const [name, burn] of [["Fast", SLO.fastBurn], ["Slow", SLO.slowBurn]] as const) {
      const threshold = Math.round(burn.rate * budgetPct * 1000) / 1000;
      const window = (minutes: number) => new cloudwatch.Alarm(this, `Burn${name}${minutes}m`, {
        metric: errorRate(minutes), threshold, evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `5xx rate above ${threshold}% over ${minutes} minutes (part of the ${name.toLowerCase()} burn-rate alarm)`,
      });
      const composite = new cloudwatch.CompositeAlarm(this, `SloBurn${name}`, {
        alarmRule: cloudwatch.AlarmRule.allOf(cloudwatch.AlarmRule.fromAlarm(window(burn.long), cloudwatch.AlarmState.ALARM),
          cloudwatch.AlarmRule.fromAlarm(window(burn.short), cloudwatch.AlarmState.ALARM)),
        alarmDescription: `Availability SLO (${SLO.availability}%): error budget burning ${burn.rate}× too fast (5xx above ${threshold}% over ${burn.long / 60} h and still over the last ${burn.short} min). docs/runbooks/incident-response.md`,
      });
      composite.addAlarmAction(new cwActions.SnsAction(this.alarmTopic));
      composite.addOkAction(new cwActions.SnsAction(this.alarmTopic));
    }

    // ---------- App CDN (admin, platform and every storefront) ----------
    const edgeFunction = new cloudfront.Function(this, "EdgeRequest", {
      code: cloudfront.FunctionCode.fromInline(EDGE_FUNCTION_CODE),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Block /internal/*, drop X-Forwarded-Host, set the client IP header",
    });
    const origin = new origins.HttpOrigin(config.originDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
      readTimeout: Duration.seconds(60),
      customHeaders: { [ORIGIN_HEADER]: this.originSecret.secretValue.unsafeUnwrap() },
    });
    this.distribution = new cloudfront.Distribution(this, "AppCdn", {
      comment: `ShopMint ${config.name} app and storefronts`,
      domainNames: [config.appDomain, `*.${config.storefrontDomain}`],
      certificate: globalCert,
      webAclId: props.webAclArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // Pages and API answers are per user and per store; Next.js caches storefront data on the servers.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        functionAssociations: [{ function: edgeFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        compress: true,
      },
      additionalBehaviors: {
        // Content-hashed build assets: safe to cache at the edge for a year.
        "/_next/static/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
    });

    // ---------- Backups ----------
    // RDS keeps continuous backups for point-in-time recovery (backupRetentionDays). AWS Backup adds daily snapshots
    // of the database and the media bucket, copied to the vault in the second Indian region.
    const plan = new backup.BackupPlan(this, "BackupPlan", {
      backupPlanName: `shopmint-${config.name}`,
      backupVault: new backup.BackupVault(this, "Vault", { backupVaultName: `shopmint-${config.name}`, removalPolicy: RemovalPolicy.RETAIN }),
    });
    plan.addRule(new backup.BackupPlanRule({
      ruleName: "daily",
      scheduleExpression: events.Schedule.cron({ hour: "21", minute: "0" }), // 02:30 IST
      deleteAfter: Duration.days(35),
      copyActions: [{
        destinationBackupVault: backup.BackupVault.fromBackupVaultArn(this, "DrVault", props.drVaultArn),
        deleteAfter: Duration.days(prod ? 90 : 14),
      }],
    }));
    plan.addSelection("Resources", {
      resources: [
        backup.BackupResource.fromRdsDatabaseInstance(this.database),
        backup.BackupResource.fromArn(this.mediaBucket.bucketArn),
      ],
    });

    // ---------- Cost guardrail ----------
    // AWS Budgets covers the whole account, so give each environment its own account (first-deploy.md). Email at 80%
    // of the actual spend and when the month's forecast passes 100%.
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: `shopmint-${config.name}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: "USD" },
      },
      notificationsWithSubscribers: [
        { notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80, thresholdType: "PERCENTAGE" },
          subscribers: [{ subscriptionType: "EMAIL", address: config.alarmEmail }] },
        { notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE" },
          subscribers: [{ subscriptionType: "EMAIL", address: config.alarmEmail }] },
      ],
    });

    // ---------- Outputs (the deploy workflow and runbooks read these) ----------
    new CfnOutput(this, "ClusterName", { value: this.cluster.clusterName });
    new CfnOutput(this, "AppSubnets", { value: this.vpc.privateSubnets.map((s) => s.subnetId).join(",") });
    new CfnOutput(this, "ApiSecurityGroupId", { value: this.apiSecurityGroup.securityGroupId });
    new CfnOutput(this, "DbEndpoint", { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, "DbInstanceId", { value: this.database.instanceIdentifier });
    new CfnOutput(this, "MediaBucket", { value: this.mediaBucket.bucketName });
    new CfnOutput(this, "MediaUploadOrigin", { value: `https://${this.mediaBucket.bucketRegionalDomainName}`, description: "Web build arg MEDIA_UPLOAD_ORIGIN" });
    new CfnOutput(this, "AppCdnDomain", { value: this.distribution.distributionDomainName, description: `DNS: ${config.appDomain} and *.${config.storefrontDomain} → this (CNAME/alias)` });
    new CfnOutput(this, "MediaCdnDomain", { value: mediaCdn.distributionDomainName, description: `DNS: ${config.mediaDomain} → this` });
    new CfnOutput(this, "LoadBalancerDns", { value: this.loadBalancer.loadBalancerDnsName, description: `DNS: ${config.originDomain} → this` });
    new CfnOutput(this, "AlarmTopicArn", { value: this.alarmTopic.topicArn });
  }
}
