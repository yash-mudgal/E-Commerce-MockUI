/**
 * Per-environment settings. Nothing here is secret. Values that differ per AWS account and are created outside CDK
 * (account ID, ACM certificate ARNs, alarm email, CloudFront prefix list) come from CDK context at deploy time, e.g.
 *   cdk deploy -c env=staging -c account=123456789012 -c certificateArnGlobal=arn:… -c certificateArnRegional=arn:… \
 *              -c alarmEmail=ops@example.com -c cloudFrontPrefixListId=pl-… -c imageTag=<git sha>
 * The deploy workflow (.github/workflows/deploy.yml) reads them from the GitHub environment's variables.
 */
export type EnvName = "staging" | "production";

export interface ServiceSize {
  cpu: number;
  memoryMiB: number;
  desired: number;
  max: number;
}

export interface EnvConfig {
  name: EnvName;
  account: string;
  region: string;
  /** Second Indian region for backup copies, so backups stay in India (DPDP Act 2023). */
  drRegion: string;
  /** Storefronts live at <subdomain>.<storefrontDomain>; the app, media and origin hosts are reserved subdomains. */
  storefrontDomain: string;
  appDomain: string;
  mediaDomain: string;
  /** The load balancer's name; CloudFront connects to it over HTTPS. Not a public entry point (origin header check). */
  originDomain: string;
  /** ACM certificate in us-east-1 for CloudFront: *.<storefrontDomain> (covers app, media and every store). */
  certificateArnGlobal: string;
  /** ACM certificate in the main region for the load balancer: *.<storefrontDomain> or the origin domain. */
  certificateArnRegional: string;
  /** Managed prefix list "com.amazonaws.global.cloudfront.origin-facing" in the main region. */
  cloudFrontPrefixListId: string;
  alarmEmail: string;
  githubRepo: string;
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
  db: {
    instanceType: string;
    multiAz: boolean;
    allocatedStorageGiB: number;
    maxAllocatedStorageGiB: number;
    backupRetentionDays: number;
    deletionProtection: boolean;
  };
  api: ServiceSize;
  web: ServiceSize;
  logRetentionDays: number;
  emailFrom: string;
  smtpHost: string;
}

const common = {
  region: "ap-south-1",
  drRegion: "ap-south-2",
  githubRepo: "yash-mudgal/E-Commerce-MockUI",
  smtpHost: "email-smtp.ap-south-1.amazonaws.com",
};

const defaults: Record<EnvName, Omit<EnvConfig, "account" | "certificateArnGlobal" | "certificateArnRegional" | "alarmEmail" | "cloudFrontPrefixListId">> = {
  staging: {
    ...common,
    name: "staging",
    storefrontDomain: "staging.shopmint.in",
    appDomain: "app.staging.shopmint.in",
    mediaDomain: "media.staging.shopmint.in",
    originDomain: "origin.staging.shopmint.in",
    vpcCidr: "10.20.0.0/16",
    maxAzs: 2,
    natGateways: 1,
    db: { instanceType: "t4g.medium", multiAz: false, allocatedStorageGiB: 20, maxAllocatedStorageGiB: 100, backupRetentionDays: 7, deletionProtection: false },
    api: { cpu: 512, memoryMiB: 1024, desired: 1, max: 2 },
    web: { cpu: 1024, memoryMiB: 2048, desired: 1, max: 2 },
    logRetentionDays: 30,
    emailFrom: "no-reply@staging.shopmint.in",
  },
  production: {
    ...common,
    name: "production",
    storefrontDomain: "shopmint.in",
    appDomain: "app.shopmint.in",
    mediaDomain: "media.shopmint.in",
    originDomain: "origin.shopmint.in",
    vpcCidr: "10.10.0.0/16",
    maxAzs: 2,
    natGateways: 2,
    // RPO 15 minutes / RTO 4 hours (PRODUCT_REQUIREMENTS.md): Multi-AZ plus 35 days of point-in-time recovery.
    db: { instanceType: "m7g.large", multiAz: true, allocatedStorageGiB: 100, maxAllocatedStorageGiB: 1000, backupRetentionDays: 35, deletionProtection: true },
    api: { cpu: 1024, memoryMiB: 2048, desired: 2, max: 6 },
    // About 70 storefront pages/s per vCPU measured in Phase 11 (RELEASE_CHECKLIST.md §3); confirm with k6 on staging.
    web: { cpu: 1024, memoryMiB: 2048, desired: 2, max: 8 },
    logRetentionDays: 90,
    emailFrom: "no-reply@shopmint.in",
  },
};

export interface ContextSource {
  tryGetContext(key: string): unknown;
}

/** Builds the config for `-c env=…`, failing fast with the list of missing context values. */
export function loadConfig(ctx: ContextSource): EnvConfig {
  const env = ctx.tryGetContext("env");
  if (env !== "staging" && env !== "production") throw new Error('Pass -c env=staging or -c env=production.');
  const required = ["account", "certificateArnGlobal", "certificateArnRegional", "alarmEmail", "cloudFrontPrefixListId"] as const;
  const values = Object.fromEntries(required.map((k) => [k, ctx.tryGetContext(k)]));
  const missing = required.filter((k) => typeof values[k] !== "string" || values[k] === "");
  if (missing.length) throw new Error(`Missing CDK context: ${missing.map((m) => `-c ${m}=…`).join(" ")}`);
  if (!/^\d{12}$/.test(values.account as string)) throw new Error("account must be a 12-digit AWS account ID.");
  if (!(values.certificateArnGlobal as string).startsWith("arn:aws:acm:us-east-1:"))
    throw new Error("certificateArnGlobal must be an ACM certificate in us-east-1 (CloudFront requires it).");
  return { ...defaults[env], ...(values as Pick<EnvConfig, (typeof required)[number]>) };
}

/** The image tag to deploy (the git SHA). Only the Migrate and Services stacks need it. */
export function imageTag(ctx: ContextSource): string {
  const tag = ctx.tryGetContext("imageTag");
  if (typeof tag !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(tag)) throw new Error("Pass -c imageTag=<git sha> (the tag pushed to ECR).");
  return tag;
}
