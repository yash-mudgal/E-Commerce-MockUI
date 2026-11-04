import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import { Construct } from "constructs";
import { apiEnvironment, apiSecrets } from "./app-env";
import { EnvConfig, ServiceSize } from "./config";
import { CoreStack, INTERNAL_NAMESPACE, ORIGIN_HEADER } from "./core-stack";
import { repositoryNames } from "./foundation-stack";

export interface ServicesStackProps extends StackProps {
  config: EnvConfig;
  core: CoreStack;
  imageTag: string;
}

/**
 * The API and web services for one release. Rolling deployments keep the old tasks until new ones pass the load
 * balancer's health check; the deployment circuit breaker rolls back automatically if they don't.
 * Rollback by hand = deploy this stack with the previous image tag (docs/runbooks/deploy-and-rollback.md).
 */
export class ServicesStack extends Stack {
  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);
    const { config, core } = props;
    const alarm = (a: cloudwatch.Alarm) => {
      a.addAlarmAction(new cwActions.SnsAction(core.alarmTopic));
      a.addOkAction(new cwActions.SnsAction(core.alarmTopic));
      return a;
    };
    const originHeader = elbv2.ListenerCondition.httpHeader(ORIGIN_HEADER, [core.originSecret.secretValue.unsafeUnwrap()]);

    // ---------- API ----------
    const apiTask = new ecs.FargateTaskDefinition(this, "ApiTask", {
      family: `shopmint-${config.name}-api`,
      cpu: config.api.cpu,
      memoryLimitMiB: config.api.memoryMiB,
    });
    core.mediaBucket.grantPut(apiTask.taskRole, "t/*");
    core.mediaBucket.grantRead(apiTask.taskRole, "t/*");
    core.mediaBucket.grantDelete(apiTask.taskRole, "t/*");
    apiTask.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryName(this, "ApiRepo", repositoryNames.api), props.imageTag),
      environment: apiEnvironment(config, core),
      secrets: apiSecrets(core),
      portMappings: [{ containerPort: 8080, name: "http" }],
      logging: ecs.LogDrivers.awsLogs({ logGroup: core.logGroups.api, streamPrefix: "api" }),
      stopTimeout: Duration.seconds(30),
    });
    const api = this.service("Api", "api", apiTask, config.api, core.apiSecurityGroup, props);

    const apiTargets = new elbv2.ApplicationTargetGroup(this, "ApiTargets", {
      vpc: core.vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: { path: "/health/ready", healthyHttpCodes: "200", interval: Duration.seconds(15), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
    });
    new elbv2.ApplicationListenerRule(this, "ApiRule", {
      listener: core.listener,
      priority: 10,
      conditions: [originHeader, elbv2.ListenerCondition.pathPatterns(["/api/*"])],
      action: elbv2.ListenerAction.forward([apiTargets]),
    });

    // ---------- Web ----------
    const webTask = new ecs.FargateTaskDefinition(this, "WebTask", {
      family: `shopmint-${config.name}-web`,
      cpu: config.web.cpu,
      memoryLimitMiB: config.web.memoryMiB,
    });
    webTask.addContainer("web", {
      // The web image is built per environment: the CSP and image hosts are fixed at build time.
      image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryName(this, "WebRepo", repositoryNames.web), `${props.imageTag}-${config.name}`),
      environment: {
        API_URL: `http://api.${INTERNAL_NAMESPACE}:8080`,
        APP_HOSTS: config.appDomain,
        STOREFRONT_URL_TEMPLATE: "https://{host}",
      },
      secrets: { REVALIDATE_SECRET: ecs.Secret.fromSecretsManager(core.revalidateSecret) },
      portMappings: [{ containerPort: 3000, name: "http" }],
      logging: ecs.LogDrivers.awsLogs({ logGroup: core.logGroups.web, streamPrefix: "web" }),
      stopTimeout: Duration.seconds(30),
    });
    const web = this.service("Web", "web", webTask, config.web, core.webSecurityGroup, props);
    const webTargets = new elbv2.ApplicationTargetGroup(this, "WebTargets", {
      vpc: core.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [web],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: { path: "/internal/health", healthyHttpCodes: "200", interval: Duration.seconds(15), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
    });
    new elbv2.ApplicationListenerRule(this, "WebRule", {
      listener: core.listener,
      priority: 20,
      conditions: [originHeader],
      action: elbv2.ListenerAction.forward([webTargets]),
    });

    // ---------- Alarms ----------
    for (const [name, tg] of [["Api", apiTargets], ["Web", webTargets]] as const) {
      alarm(new cloudwatch.Alarm(this, `${name}Unhealthy`, {
        metric: tg.metrics.unhealthyHostCount({ period: Duration.minutes(1), statistic: "Maximum" }),
        threshold: 1, evaluationPeriods: 5, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription: `${name}: an unhealthy task for 5 minutes`,
      }));
    }
    alarm(new cloudwatch.Alarm(this, "ApiLatencyP95", {
      metric: apiTargets.metrics.targetResponseTime({ period: Duration.minutes(5), statistic: "p95" }),
      threshold: 0.8, evaluationPeriods: 2,
      alarmDescription: "API p95 latency above 800 ms for 10 minutes (NFR: reads < 300 ms, checkout < 800 ms)",
    }));
    alarm(new cloudwatch.Alarm(this, "WebLatencyP95", {
      metric: webTargets.metrics.targetResponseTime({ period: Duration.minutes(5), statistic: "p95" }),
      threshold: 1, evaluationPeriods: 2,
      alarmDescription: "Page p95 above 1 s for 10 minutes: web tasks saturated? (≈70 pages/s per vCPU)",
    }));
    const apiErrors = new logs.MetricFilter(this, "ApiErrors", {
      logGroup: core.logGroups.api,
      metricNamespace: "ShopMint",
      metricName: `${config.name}-api-errors`,
      filterPattern: logs.FilterPattern.any(
        logs.FilterPattern.stringValue("$.LogLevel", "=", "Error"),
        logs.FilterPattern.stringValue("$.LogLevel", "=", "Critical"),
      ),
      metricValue: "1",
      defaultValue: 0,
    });
    alarm(new cloudwatch.Alarm(this, "ApiErrorLogs", {
      metric: apiErrors.metric({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 20, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "More than 20 API errors logged in 5 minutes (webhooks, email delivery, unhandled exceptions)",
    }));

    new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `shopmint-${config.name}`,
      widgets: [[
        new cloudwatch.GraphWidget({ title: "Requests", left: [apiTargets.metrics.requestCount(), webTargets.metrics.requestCount()] }),
        new cloudwatch.GraphWidget({ title: "p95 latency (s)", left: [apiTargets.metrics.targetResponseTime({ statistic: "p95" }), webTargets.metrics.targetResponseTime({ statistic: "p95" })] }),
        new cloudwatch.GraphWidget({ title: "5xx", left: [apiTargets.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT), webTargets.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT)] }),
      ], [
        new cloudwatch.GraphWidget({ title: "CPU %", left: [api.metricCpuUtilization(), web.metricCpuUtilization()] }),
        new cloudwatch.GraphWidget({ title: "Memory %", left: [api.metricMemoryUtilization(), web.metricMemoryUtilization()] }),
        new cloudwatch.GraphWidget({ title: "Database", left: [core.database.metricCPUUtilization()], right: [core.database.metricDatabaseConnections()] }),
        new cloudwatch.GraphWidget({ title: "API errors logged", left: [apiErrors.metric({ statistic: "Sum" })] }),
      ]],
    });

    new CfnOutput(this, "ImageTag", { value: props.imageTag });
  }

  private service(id: string, name: string, task: ecs.FargateTaskDefinition, size: ServiceSize, sg: ec2.ISecurityGroup,
    props: ServicesStackProps): ecs.FargateService {
    const { core } = props;
    const service = new ecs.FargateService(this, id, {
      serviceName: `${name}`,
      cluster: core.cluster,
      taskDefinition: task,
      desiredCount: size.desired,
      securityGroups: [sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: Duration.seconds(60),
      enableExecuteCommand: false,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      // One A record per running task: the web tasks are all reached for cache refreshes (Web:RevalidateFanOut).
      cloudMapOptions: { name, cloudMapNamespace: core.namespace, dnsRecordType: servicediscovery.DnsRecordType.A, dnsTtl: Duration.seconds(10) },
    });
    const scaling = service.autoScaleTaskCount({ minCapacity: size.desired, maxCapacity: size.max });
    scaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60, scaleOutCooldown: Duration.seconds(60), scaleInCooldown: Duration.minutes(5) });
    for (const [metric, label] of [[service.metricCpuUtilization({ period: Duration.minutes(5) }), "CPU"], [service.metricMemoryUtilization({ period: Duration.minutes(5) }), "Memory"]] as const) {
      new cloudwatch.Alarm(this, `${id}${label}`, {
        metric, threshold: 85, evaluationPeriods: 3,
        alarmDescription: `${name}: ${label} above 85% for 15 minutes (at max tasks?)`,
      }).addAlarmAction(new cwActions.SnsAction(core.alarmTopic));
    }
    return service;
  }
}
