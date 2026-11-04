/**
 * Monthly cost estimate for one environment: what the CDK app would create (read from the synthesised templates, so
 * the estimate follows infra changes) × AWS list prices × usage assumptions. It feeds `monthlyBudgetUsd`
 * (docs/COST_REVIEW.md). Run `npm run cost` in infra/.
 *
 * Prices: AWS Price List bulk API (https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json), on-demand,
 * USD, Asia Pacific (Mumbai) unless noted, retrieved 2026-11-04. Offer versions are in PRICE_SOURCE. No free tier,
 * credits, savings plans or taxes (AWS adds 18% GST on Indian accounts) are applied.
 */
import type { CloudAssembly } from "aws-cdk-lib/cx-api";

export const HOURS_PER_MONTH = 730;

export const PRICE_SOURCE = {
  retrieved: "2026-11-04",
  url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json",
  offers: {
    AmazonECS: "20261019224317", AmazonRDS: "20261029070635", AmazonEC2: "20261103235716", AWSELB: "20261102102527",
    AmazonCloudFront: "20261019150500", awswaf: "20260914163921", AmazonS3: "20261015173540", AWSBackup: "20261014001856",
    AmazonCloudWatch: "20261007115540", AWSSecretsManager: "20260911124610", AmazonSES: "20261027230824",
    AmazonECR: "20260911124425", AWSDataTransfer: "20261103133147", AWSCloudMap: "20260911124531", AmazonRoute53: "20260911124504",
  },
} as const;

export const PRICES = {
  fargateVcpuHour: 0.04256, // APS3-Fargate-vCPU-Hours:perCPU (Linux/x86)
  fargateGbHour: 0.004655, // APS3-Fargate-GB-Hours
  rdsInstanceHour: {
    // PostgreSQL, APS3-InstanceUsage / APS3-Multi-AZUsage (Multi-AZ price covers primary and standby)
    "db.t4g.medium": { single: 0.084, multiAz: 0.167 },
    "db.m7g.large": { single: 0.24, multiAz: 0.479 },
  } as Record<string, { single: number; multiAz: number }>,
  rdsGp3GbMonth: { single: 0.131, multiAz: 0.262 }, // APS3-RDS:GP3-Storage, APS3-RDS:Multi-AZ-GP3-Storage
  rdsSnapshotGbMonth: 0.095, // RDS:ChargedBackupUsage beyond the free allocation (same in ap-south-2)
  rdsT4gCpuCreditVcpuHour: 0.075, // APS3-CPUCredits:db.t4g (unlimited mode surplus)
  dbInsightsStandardVcpuHour: 0.002305, // APS3-CW:DatabaseInsights-Standard-FMR-vCPU-Hours (RDS PostgreSQL)
  natHour: 0.056, // APS3-NatGateway-Hours
  natGb: 0.056, // APS3-NatGateway-Bytes
  albHour: 0.0239, // APS3-LoadBalancerUsage (application)
  albLcuHour: 0.008, // APS3-LCUUsage (application)
  cloudFrontIndiaGb: 0.109, // IN-DataTransfer-Out-Bytes, first 10 TB
  cloudFrontIndiaHttpsRequest: 0.012 / 10_000, // IN-Requests-Tier2-HTTPS
  cloudFrontFunctionInvocation: 0.1 / 1_000_000, // Executions-CloudFrontFunctions (first 2M a month free; not applied)
  wafWebAclMonth: 5, // USE1-WebACL (CloudFront web ACLs live in us-east-1)
  wafRuleMonth: 1, // USE1-Rule (a managed rule group is billed as one rule)
  wafRequest: 0.6 / 1_000_000, // USE1-Request
  s3GbMonth: 0.025, // APS3-TimedStorage-ByteHrs, first 50 TB
  s3PutRequest: 0.005 / 1000, // APS3-Requests-Tier1
  s3GetRequest: 0.004 / 10_000, // APS3-Requests-Tier2
  backupS3WarmGbMonth: 0.055, // APS3/APS5-WarmStorage-ByteHrs-S3
  interRegionGb: 0.086, // APS3-APS5-AWS-Out-Bytes (Mumbai → Hyderabad), also the AWS Backup cross-Region rate
  interAzGb: 0.01, // APS3-DataTransfer-Regional-Bytes, charged in each direction
  logsIngestGb: 0.67, // APS3-DataProcessing-Bytes (standard class)
  vendedLogsIngestGb: 0.67, // APS3-VendedLog-Bytes, first 10 TB (VPC flow logs)
  logsStorageGbMonth: 0.03, // APS3-TimedStorage-ByteHrs
  alarmMetricMonth: 0.1, // APS3-CW:AlarmMonitorUsage (a metric-math alarm is billed per metric it reads)
  compositeAlarmMonth: 0.5, // APS3-CW:CompositeAlarmMonitorUsage
  customMetricMonth: 0.3, // APS3-CW:MetricMonitorUsage, first 10,000
  observation: 0.21 / 1_000_000, // APS3-CW:ObservationUsage (Container Insights with enhanced observability)
  // Not in the Price List files; from https://aws.amazon.com/cloudwatch/pricing/ (first 3 per account are free).
  dashboardMonth: 3,
  secretMonth: 0.4, // APS3-AWSSecretsManager-Secrets
  sesEmail: 0.0001, // APS3-Recipients
  ecrGbMonth: 0.1, // APS3-TimedStorage-ByteHrs
  hostedZoneMonth: 0.5, // HostedZone, first 25 (Cloud Map private DNS namespace)
  cloudMapResourceMonth: 0.1, // APS3-Cloud-Map-Resources (registered task instances)
} as const;

/** What the environment would create, read from the synthesised CloudFormation templates. */
export interface Inventory {
  services: { name: string; vcpu: number; memoryGb: number; desired: number }[];
  oneOffTask: { vcpu: number; memoryGb: number };
  db: { instanceClass: string; multiAz: boolean; storageGb: number; vcpu: number; performanceInsights: boolean };
  natGateways: number;
  loadBalancers: number;
  distributions: number;
  wafRules: number;
  wafWebAcls: number;
  alarmMetrics: number;
  compositeAlarms: number;
  /** Target tracking scaling policies; Application Auto Scaling creates two alarms for each. */
  scalingPolicies: number;
  metricFilters: number;
  dashboards: number;
  secrets: number;
  privateNamespaces: number;
  logRetentionDays: number;
  containerInsightsEnhanced: boolean;
  backupCopyRetentionDays: number;
  backupRetentionDays: number;
}

/** Usage that the templates can't tell: traffic, data sizes and change rates. */
export interface Usage {
  pageViews: number;
  /** Requests to the app distribution per page view after browser caching (HTML, RSC, scripts, API calls). */
  appRequestsPerView: number;
  appKbPerView: number;
  mediaRequestsPerView: number;
  mediaKbPerView: number;
  /** Share of media requests that miss CloudFront and read S3. */
  mediaOriginShare: number;
  mediaGb: number;
  mediaUploadsPerMonth: number;
  mediaChangeGbPerDay: number;
  dbDataGb: number;
  dbChangeGbPerDay: number;
  albLcuAverage: number;
  /** Task-hours above the desired count (autoscaling peaks), per service. */
  extraTaskHours: number;
  /** Database CPU above the t4g baseline, in vCPU-hours (unlimited mode); 0 for non-burstable classes. */
  dbCpuSurplusVcpuHours: number;
  appLogsGb: number;
  flowLogsGb: number;
  rdsLogsGb: number;
  albLogsGb: number;
  /** NAT data besides log shipping: Razorpay, SES, Secrets Manager, ECR API (layers use the S3 gateway endpoint). */
  natOtherGb: number;
  interAzGb: number;
  emails: number;
  ecrGb: number;
  releases: number;
  oneOffTaskMinutes: number;
  /** Container Insights (enhanced) observations per task per minute. Not documented as a fixed number: measure. */
  observationsPerTaskMinute: number;
}

/**
 * Launch-stage assumptions. Production: 2 million storefront page views a month (about 0.8/s on average, well under
 * the ~70 pages/s per vCPU measured in Phase 11). Replace them with measured values after the first month.
 */
export const DEFAULT_USAGE: Record<"staging" | "production", Usage> = {
  production: {
    pageViews: 2_000_000, appRequestsPerView: 6, appKbPerView: 150, mediaRequestsPerView: 4, mediaKbPerView: 240,
    mediaOriginShare: 0.05, mediaGb: 50, mediaUploadsPerMonth: 20_000, mediaChangeGbPerDay: 0.5,
    dbDataGb: 10, dbChangeGbPerDay: 0.3, albLcuAverage: 1, extraTaskHours: 200, dbCpuSurplusVcpuHours: 0,
    appLogsGb: 15, flowLogsGb: 5, rdsLogsGb: 2, albLogsGb: 10, natOtherGb: 10, interAzGb: 50, emails: 50_000,
    ecrGb: 10, releases: 20, oneOffTaskMinutes: 5, observationsPerTaskMinute: 100,
  },
  staging: {
    pageViews: 20_000, appRequestsPerView: 6, appKbPerView: 150, mediaRequestsPerView: 4, mediaKbPerView: 240,
    mediaOriginShare: 0.2, mediaGb: 5, mediaUploadsPerMonth: 1_000, mediaChangeGbPerDay: 0.05,
    dbDataGb: 2, dbChangeGbPerDay: 0.05, albLcuAverage: 0.2, extraTaskHours: 20, dbCpuSurplusVcpuHours: 20,
    appLogsGb: 3, flowLogsGb: 1, rdsLogsGb: 0.5, albLogsGb: 0.5, natOtherGb: 3, interAzGb: 5, emails: 2_000,
    ecrGb: 10, releases: 40, oneOffTaskMinutes: 5, observationsPerTaskMinute: 100,
  },
};

const DB_VCPUS: Record<string, number> = { "db.t4g.medium": 2, "db.m7g.large": 2 };

type Resource = { Type: string; Properties?: Record<string, any> };

/** Counts billable resources in every stack of the synthesised app. */
export function inventoryFrom(assembly: CloudAssembly): Inventory {
  const resources: Resource[] = assembly.stacks.flatMap((s) => Object.values((s.template.Resources ?? {}) as Record<string, Resource>));
  const of = (type: string) => resources.filter((r) => r.Type === type).map((r) => r.Properties ?? {});
  const count = (type: string) => of(type).length;

  // Services point at their task definitions with { Ref: <logical id> } inside the same stack.
  const sizeOf = (t: Record<string, any>) => ({ vcpu: Number(t.Cpu) / 1024, memoryGb: Number(t.Memory) / 1024 });
  const services: Inventory["services"] = [];
  let oneOff = { vcpu: 0, memoryGb: 0 };
  for (const stack of assembly.stacks) {
    const byId = (stack.template.Resources ?? {}) as Record<string, Resource>;
    for (const [id, r] of Object.entries(byId)) {
      if (r.Type === "AWS::ECS::Service") {
        const taskDef = byId[r.Properties?.TaskDefinition?.Ref];
        if (!taskDef) throw new Error(`Can't find the task definition of ${id}.`);
        services.push({ name: id.replace(/Service.*$/, "").toLowerCase() || id, ...sizeOf(taskDef.Properties ?? {}), desired: Number(r.Properties?.DesiredCount ?? 1) });
      }
    }
    for (const [id, r] of Object.entries(byId))
      if (r.Type === "AWS::ECS::TaskDefinition" && /deploy|migrate/i.test(id)) oneOff = sizeOf(r.Properties ?? {});
  }
  if (services.length === 0) throw new Error("No ECS services in the templates; synthesise with -c imageTag=….");

  const [db] = of("AWS::RDS::DBInstance");
  if (!db) throw new Error("No RDS instance in the templates.");
  const instanceClass = String(db.DBInstanceClass);
  if (!PRICES.rdsInstanceHour[instanceClass]) throw new Error(`No price for ${instanceClass}; add it to PRICES.`);

  const alarms = of("AWS::CloudWatch::Alarm");
  const alarmMetrics = alarms.reduce((n, a) => n + (a.Metrics ? (a.Metrics as any[]).filter((m) => m.MetricStat).length : 1), 0);
  const logGroups = of("AWS::Logs::LogGroup").map((l) => Number(l.RetentionInDays ?? 0)).filter((d) => d > 0);
  const cluster = of("AWS::ECS::Cluster")[0] ?? {};
  const plan = of("AWS::Backup::BackupPlan")[0]?.BackupPlan?.BackupPlanRule?.[0] ?? {};

  return {
    services,
    oneOffTask: oneOff,
    db: {
      instanceClass, multiAz: db.MultiAZ === true, storageGb: Number(db.AllocatedStorage), vcpu: DB_VCPUS[instanceClass] ?? 2,
      performanceInsights: db.EnablePerformanceInsights === true,
    },
    natGateways: count("AWS::EC2::NatGateway"),
    loadBalancers: count("AWS::ElasticLoadBalancingV2::LoadBalancer"),
    distributions: count("AWS::CloudFront::Distribution"),
    wafRules: of("AWS::WAFv2::WebACL").reduce((n, acl) => n + (acl.Rules?.length ?? 0), 0),
    wafWebAcls: count("AWS::WAFv2::WebACL"),
    alarmMetrics,
    compositeAlarms: count("AWS::CloudWatch::CompositeAlarm"),
    scalingPolicies: of("AWS::ApplicationAutoScaling::ScalingPolicy").filter((p) => p.PolicyType === "TargetTrackingScaling").length,
    metricFilters: count("AWS::Logs::MetricFilter"),
    dashboards: count("AWS::CloudWatch::Dashboard"),
    secrets: count("AWS::SecretsManager::Secret"),
    privateNamespaces: count("AWS::ServiceDiscovery::PrivateDnsNamespace"),
    logRetentionDays: Math.max(0, ...logGroups),
    containerInsightsEnhanced: (cluster.ClusterSettings ?? []).some((s: any) => s.Name === "containerInsights" && s.Value === "enhanced"),
    backupRetentionDays: Number(plan.Lifecycle?.DeleteAfterDays ?? 0),
    backupCopyRetentionDays: Number(plan.CopyActions?.[0]?.Lifecycle?.DeleteAfterDays ?? 0),
  };
}

export interface LineItem {
  group: "Compute" | "Database" | "Network" | "Edge" | "Storage and backup" | "Observability" | "Other";
  item: string;
  basis: string;
  usd: number;
  /** "fixed" doesn't move with traffic; "usage" depends on the Usage assumptions. */
  kind: "fixed" | "usage";
}

const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits });

/** Prices the inventory under the usage assumptions. One-account-per-environment, so nothing is shared. */
export function estimate(inv: Inventory, u: Usage): LineItem[] {
  const P = PRICES;
  const H = HOURS_PER_MONTH;
  const items: LineItem[] = [];
  const add = (group: LineItem["group"], item: string, basis: string, usd: number, kind: LineItem["kind"]) =>
    items.push({ group, item, basis, usd, kind });

  // ---- Compute
  const taskHourPrice = (vcpu: number, gb: number) => vcpu * P.fargateVcpuHour + gb * P.fargateGbHour;
  for (const s of inv.services) {
    const hourly = taskHourPrice(s.vcpu, s.memoryGb);
    add("Compute", `Fargate ${s.name}`, `${s.desired} × ${s.vcpu} vCPU / ${s.memoryGb} GB × ${H} h`, s.desired * H * hourly, "fixed");
    if (u.extraTaskHours > 0) add("Compute", `Fargate ${s.name}, autoscaling peaks`, `${fmt(u.extraTaskHours)} extra task-hours`, u.extraTaskHours * hourly, "usage");
  }
  const oneOffHours = (u.releases * u.oneOffTaskMinutes) / 60;
  add("Compute", "Fargate deploy-db task", `${u.releases} releases × ${u.oneOffTaskMinutes} min`, oneOffHours * taskHourPrice(inv.oneOffTask.vcpu, inv.oneOffTask.memoryGb), "usage");

  // ---- Database
  const rds = P.rdsInstanceHour[inv.db.instanceClass];
  add("Database", `RDS ${inv.db.instanceClass}${inv.db.multiAz ? " Multi-AZ" : ""}`, `${H} h × $${inv.db.multiAz ? rds.multiAz : rds.single}`, H * (inv.db.multiAz ? rds.multiAz : rds.single), "fixed");
  add("Database", "RDS gp3 storage", `${inv.db.storageGb} GB provisioned`, inv.db.storageGb * (inv.db.multiAz ? P.rdsGp3GbMonth.multiAz : P.rdsGp3GbMonth.single), "fixed");
  if (inv.db.instanceClass.startsWith("db.t") && u.dbCpuSurplusVcpuHours > 0)
    add("Database", "RDS CPU credits (burst above baseline)", `${fmt(u.dbCpuSurplusVcpuHours)} vCPU-h`, u.dbCpuSurplusVcpuHours * P.rdsT4gCpuCreditVcpuHour, "usage");
  if (inv.db.performanceInsights)
    add("Database", "Database Insights (Standard), conservative", `${inv.db.vcpu} vCPU × ${H} h; may be free at 7-day retention`, inv.db.vcpu * H * P.dbInsightsStandardVcpuHour, "fixed");
  // Snapshots are incremental. Point-in-time backups plus the daily AWS Backup snapshots in the main region are free
  // up to the provisioned storage; anything above is charged. Copies in ap-south-2 are all charged.
  const mainSnapshotGb = u.dbDataGb + u.dbChangeGbPerDay * inv.backupRetentionDays;
  add("Database", "Backup storage, main region", `~${fmt(mainSnapshotGb)} GB vs ${inv.db.storageGb} GB free`, Math.max(0, mainSnapshotGb - inv.db.storageGb) * P.rdsSnapshotGbMonth, "usage");
  const copyGb = u.dbDataGb + u.dbChangeGbPerDay * inv.backupCopyRetentionDays;
  add("Database", "Backup copies in ap-south-2", `~${fmt(copyGb)} GB snapshot storage`, copyGb * P.rdsSnapshotGbMonth, "usage");
  add("Database", "Backup copy transfer to ap-south-2", `~${fmt(u.dbChangeGbPerDay * 30, 1)} GB incremental a month`, u.dbChangeGbPerDay * 30 * P.interRegionGb, "usage");

  // ---- Network
  const logsGb = u.appLogsGb + u.rdsLogsGb; // shipped from tasks through the NAT gateways
  add("Network", `NAT gateways × ${inv.natGateways}`, `${inv.natGateways} × ${H} h`, inv.natGateways * H * P.natHour, "fixed");
  add("Network", "NAT data processed", `${fmt(logsGb + u.natOtherGb)} GB (logs + external APIs)`, (logsGb + u.natOtherGb) * P.natGb, "usage");
  add("Network", "Application Load Balancer", `${inv.loadBalancers} × ${H} h`, inv.loadBalancers * H * P.albHour, "fixed");
  add("Network", "ALB capacity units", `${u.albLcuAverage} LCU average × ${H} h`, u.albLcuAverage * H * P.albLcuHour, "usage");
  add("Network", "Cross-AZ traffic", `${fmt(u.interAzGb)} GB × 2 directions`, u.interAzGb * 2 * P.interAzGb, "usage");
  add("Network", "Cloud Map (private DNS + task records)", `${inv.privateNamespaces} zone, ${inv.services.reduce((n, s) => n + s.desired, 0)} records`,
    inv.privateNamespaces * P.hostedZoneMonth + inv.services.reduce((n, s) => n + s.desired, 0) * P.cloudMapResourceMonth, "fixed");

  // ---- Edge (CloudFront from Mumbai origin is free; India edge prices for shoppers)
  const appRequests = u.pageViews * u.appRequestsPerView;
  const mediaRequests = u.pageViews * u.mediaRequestsPerView;
  const cdnGb = (u.pageViews * (u.appKbPerView + u.mediaKbPerView)) / 1024 / 1024;
  add("Edge", "CloudFront data to shoppers", `${fmt(cdnGb)} GB (India)`, cdnGb * P.cloudFrontIndiaGb, "usage");
  add("Edge", "CloudFront HTTPS requests", `${fmt((appRequests + mediaRequests) / 1e6, 1)} M`, (appRequests + mediaRequests) * P.cloudFrontIndiaHttpsRequest, "usage");
  add("Edge", "CloudFront Function (app viewer requests)", `${fmt(appRequests / 1e6, 1)} M`, appRequests * P.cloudFrontFunctionInvocation, "usage");
  add("Edge", "WAF web ACL and rules", `${inv.wafWebAcls} ACL + ${inv.wafRules} rules`, inv.wafWebAcls * P.wafWebAclMonth + inv.wafRules * P.wafRuleMonth, "fixed");
  add("Edge", "WAF requests (app distribution)", `${fmt(appRequests / 1e6, 1)} M`, appRequests * P.wafRequest, "usage");

  // ---- Storage and backup
  add("Storage and backup", "S3 media", `${fmt(u.mediaGb)} GB + old versions (30 days)`, (u.mediaGb + u.mediaChangeGbPerDay * 30) * P.s3GbMonth, "usage");
  add("Storage and backup", "S3 requests", `${fmt(u.mediaUploadsPerMonth)} uploads, ${fmt(mediaRequests * u.mediaOriginShare / 1e6, 2)} M origin reads`,
    u.mediaUploadsPerMonth * P.s3PutRequest + mediaRequests * u.mediaOriginShare * P.s3GetRequest, "usage");
  add("Storage and backup", "S3 load balancer logs", `${fmt(u.albLogsGb)} GB/month × ${inv.logRetentionDays} days`, u.albLogsGb * (inv.logRetentionDays / 30) * P.s3GbMonth, "usage");
  const mediaBackupGb = (days: number) => u.mediaGb + u.mediaChangeGbPerDay * days;
  add("Storage and backup", "AWS Backup of media (both regions)", `~${fmt(mediaBackupGb(inv.backupRetentionDays))} + ${fmt(mediaBackupGb(inv.backupCopyRetentionDays))} GB warm`,
    (mediaBackupGb(inv.backupRetentionDays) + mediaBackupGb(inv.backupCopyRetentionDays)) * P.backupS3WarmGbMonth + u.mediaChangeGbPerDay * 30 * P.interRegionGb, "usage");
  add("Storage and backup", "ECR images", `${fmt(u.ecrGb)} GB`, u.ecrGb * P.ecrGbMonth, "usage");

  // ---- Observability
  const ingestGb = logsGb;
  add("Observability", "CloudWatch Logs ingestion", `${fmt(ingestGb, 1)} GB app/database + ${fmt(u.flowLogsGb)} GB flow logs`, ingestGb * P.logsIngestGb + u.flowLogsGb * P.vendedLogsIngestGb, "usage");
  add("Observability", "CloudWatch Logs storage", `${inv.logRetentionDays} days retained`, (ingestGb + u.flowLogsGb) * (inv.logRetentionDays / 30) * P.logsStorageGbMonth, "usage");
  const alarmMetrics = inv.alarmMetrics + inv.scalingPolicies * 2;
  add("Observability", "CloudWatch alarms", `${alarmMetrics} alarm metrics + ${inv.compositeAlarms} composite`, alarmMetrics * P.alarmMetricMonth + inv.compositeAlarms * P.compositeAlarmMonth, "fixed");
  add("Observability", "CloudWatch dashboard and custom metrics", `${inv.dashboards} dashboard, ${inv.metricFilters} metric filter`, inv.dashboards * P.dashboardMonth + inv.metricFilters * P.customMetricMonth, "fixed");
  if (inv.containerInsightsEnhanced) {
    const tasks = inv.services.reduce((n, s) => n + s.desired, 0);
    const obs = (tasks * H + u.extraTaskHours * inv.services.length) * 60 * u.observationsPerTaskMinute;
    add("Observability", "Container Insights (enhanced)", `~${fmt(obs / 1e6, 1)} M observations (assumed ${u.observationsPerTaskMinute}/task/min)`, obs * P.observation, "usage");
  }

  // ---- Other
  const operatorSecrets = 1; // payments/billing keys entered by an operator (docs/runbooks/first-deploy.md)
  add("Other", "Secrets Manager", `${inv.secrets} created + ${operatorSecrets} operator secret`, (inv.secrets + operatorSecrets) * P.secretMonth, "fixed");
  add("Other", "SES email", `${fmt(u.emails)} emails`, u.emails * P.sesEmail, "usage");

  return items;
}

export const total = (items: LineItem[], kind?: LineItem["kind"]) =>
  items.filter((i) => !kind || i.kind === kind).reduce((n, i) => n + i.usd, 0);

/** Budget suggestion: the estimate plus 20% headroom, rounded up to the next $50. */
export const suggestedBudget = (items: LineItem[]) => Math.ceil((total(items) * 1.2) / 50) * 50;

export function toMarkdown(env: string, items: LineItem[]): string {
  const rows = items.map((i) => `| ${i.group} | ${i.item} | ${i.basis} | ${i.kind} | ${i.usd.toFixed(2)} |`);
  return [
    `### ${env}`,
    "",
    "| Group | Item | Basis | Kind | USD/month |",
    "|---|---|---|---|---:|",
    ...rows,
    `| | **Fixed (doesn't move with traffic)** | | | **${total(items, "fixed").toFixed(2)}** |`,
    `| | **Usage-based (assumptions)** | | | **${total(items, "usage").toFixed(2)}** |`,
    `| | **Total, before tax** | | | **${total(items).toFixed(2)}** |`,
    `| | **Suggested \`MONTHLY_BUDGET_USD\`** (total + 20%, rounded up to $50) | | | **${suggestedBudget(items)}** |`,
  ].join("\n");
}
