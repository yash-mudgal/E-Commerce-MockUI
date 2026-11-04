import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildApp } from "../bin/shopmint";
import { imageTag, loadConfig } from "../lib/config";
import { CLIENT_IP_HEADER, EDGE_FUNCTION_CODE, ORIGIN_HEADER } from "../lib/core-stack";

const context = (env: string, extra: Record<string, string> = {}) => ({
  env,
  account: "111111111111",
  certificateArnGlobal: "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000",
  certificateArnRegional: "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000001",
  alarmEmail: "ops@example.com",
  cloudFrontPrefixListId: "pl-00000000",
  imageTag: "0123abc",
  ...extra,
});

const synth = (env: "staging" | "production") => {
  const app = buildApp(new App({ context: context(env) }));
  const t = (name: string) => Template.fromStack(app.node.findChild(`ShopMint-${env}-${name}`) as Stack);
  return { core: t("Core"), services: t("Services"), migrate: t("Migrate"), foundation: t("Foundation"), edge: t("Edge"), dr: t("Dr") };
};
const prod = synth("production");
const staging = synth("staging");

const ctx = (values: Record<string, unknown>) => ({ tryGetContext: (k: string) => values[k] });

describe("config", () => {
  it("names every missing context value", () => {
    expect(() => loadConfig(ctx({ env: "staging" }))).toThrow(/-c account=… -c certificateArnGlobal=… -c certificateArnRegional=… -c alarmEmail=… -c cloudFrontPrefixListId=…/);
    expect(() => loadConfig(ctx({ env: "prod" }))).toThrow(/env=staging or -c env=production/);
  });
  it("needs a us-east-1 certificate for CloudFront and a real account ID", () => {
    expect(() => loadConfig(ctx({ ...context("staging"), certificateArnGlobal: "arn:aws:acm:ap-south-1:1:certificate/x" }))).toThrow(/us-east-1/);
    expect(() => loadConfig(ctx({ ...context("staging"), account: "12345" }))).toThrow(/12-digit/);
  });
  it("accepts only plain image tags", () => {
    expect(imageTag(ctx({ imageTag: "9f2c1e0" }))).toBe("9f2c1e0");
    expect(() => imageTag(ctx({ imageTag: "latest; rm -rf /" }))).toThrow();
    expect(() => imageTag(ctx({}))).toThrow(/imageTag/);
  });
  it("leaves the release stacks out until an image tag is given", () => {
    const app = buildApp(new App({ context: { ...context("staging"), imageTag: undefined as never } }));
    expect(app.node.children.map((c) => c.node.id)).not.toContain("ShopMint-staging-Services");
  });
});

describe("database", () => {
  it("is private, encrypted, TLS-only and keeps 35 days of point-in-time recovery in production", () => {
    prod.core.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres", MultiAZ: true, StorageEncrypted: true, PubliclyAccessible: false, DeletionProtection: true,
      BackupRetentionPeriod: 35, EnablePerformanceInsights: true, CACertificateIdentifier: "rds-ca-rsa2048-g1",
    });
    prod.core.hasResourceProperties("AWS::RDS::DBParameterGroup", { Parameters: Match.objectLike({ "rds.force_ssl": "1" }) });
    prod.core.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Retain" });
    staging.core.hasResourceProperties("AWS::RDS::DBInstance", { MultiAZ: false, BackupRetentionPeriod: 7 });
  });
  it("only accepts connections from the API security group", () => {
    const ingress = prod.core.findResources("AWS::EC2::SecurityGroupIngress", { Properties: { FromPort: 5432 } });
    expect(Object.keys(ingress)).toHaveLength(1);
  });
  it("is backed up daily with copies in the second Indian region", () => {
    prod.core.hasResourceProperties("AWS::Backup::BackupPlan", {
      BackupPlan: { BackupPlanRule: [Match.objectLike({ Lifecycle: { DeleteAfterDays: 35 }, CopyActions: [Match.objectLike({ Lifecycle: { DeleteAfterDays: 90 } })] })] },
    });
    prod.dr.hasResourceProperties("AWS::Backup::BackupVault", { LockConfiguration: { MinRetentionDays: 7 } });
    expect(prod.dr.toJSON()).toBeDefined();
  });
});

describe("edge and load balancer", () => {
  it("lets only CloudFront reach the load balancer, and only with the origin header", () => {
    const albSg = Object.entries(prod.core.findResources("AWS::EC2::SecurityGroup", {
      Properties: { GroupDescription: "Load balancer: HTTPS from CloudFront only" },
    }))[0];
    expect(albSg[1].Properties.SecurityGroupIngress).toBeUndefined();
    const ingress = Object.values(prod.core.findResources("AWS::EC2::SecurityGroupIngress", {
      Properties: { GroupId: { "Fn::GetAtt": [albSg[0], "GroupId"] } },
    })).map((r) => r.Properties);
    expect(ingress).toEqual([{ Description: "CloudFront origin-facing", FromPort: 443, ToPort: 443, IpProtocol: "tcp", SourcePrefixListId: "pl-00000000", GroupId: { "Fn::GetAtt": [albSg[0], "GroupId"] } }]);
    prod.core.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Protocol: "HTTPS", SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      DefaultActions: [Match.objectLike({ Type: "fixed-response", FixedResponseConfig: Match.objectLike({ StatusCode: "403" }) })],
    });
    const rules = prod.services.findResources("AWS::ElasticLoadBalancingV2::ListenerRule");
    expect(Object.keys(rules)).toHaveLength(2);
    for (const rule of Object.values(rules))
      expect(JSON.stringify(rule.Properties.Conditions)).toContain(ORIGIN_HEADER);
  });
  it("puts the web ACL and the edge function on the app distribution", () => {
    prod.core.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["app.shopmint.in", "*.shopmint.in"],
        WebACLId: Match.anyValue(),
        DefaultCacheBehavior: Match.objectLike({ FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })] }),
      }),
    });
    prod.edge.hasResourceProperties("AWS::WAFv2::WebACL", { Scope: "CLOUDFRONT" });
  });
  it("keeps the media bucket private and TLS-only", () => {
    prod.core.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      VersioningConfiguration: { Status: "Enabled" },
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ["PUT"], AllowedOrigins: ["https://app.shopmint.in"] })] },
    });
  });
});

describe("edge function", () => {
  const run = (uri: string, headers: Record<string, { value: string }> = {}) => {
    const sandbox: { result?: unknown; event: unknown } = { event: { request: { uri, headers }, viewer: { ip: "203.0.113.7" } } };
    runInNewContext(`${EDGE_FUNCTION_CODE}; result = handler(event);`, sandbox);
    return sandbox.result as { statusCode?: number; headers?: Record<string, { value: string }> };
  };
  it("hides /internal/*", () => {
    expect(run("/internal/revalidate").statusCode).toBe(404);
    expect(run("/internal/health").statusCode).toBe(404);
  });
  it("drops X-Forwarded-Host and overwrites the client IP header", () => {
    const req = run("/products", { "x-forwarded-host": { value: "other-store.shopmint.in" }, [CLIENT_IP_HEADER.toLowerCase()]: { value: "1.1.1.1" } });
    expect(req.headers?.["x-forwarded-host"]).toBeUndefined();
    expect(req.headers?.[CLIENT_IP_HEADER.toLowerCase()]).toEqual({ value: "203.0.113.7" });
    expect(req.statusCode).toBeUndefined();
  });
});

describe("services", () => {
  const containers = (t: Template) =>
    Object.values(t.findResources("AWS::ECS::TaskDefinition")).flatMap((r) => r.Properties.ContainerDefinitions as Array<Record<string, unknown>>);

  it("run the API in Production with test payments off, no proxy wildcard and secrets only from Secrets Manager", () => {
    const api = containers(prod.services).find((c) => c.Name === "api")!;
    const env = Object.fromEntries((api.Environment as Array<{ Name: string; Value: unknown }>).map((e) => [e.Name, e.Value]));
    expect(env.ASPNETCORE_ENVIRONMENT).toBe("Production");
    expect(env.Payments__AllowTestMode).toBe("false");
    expect(env.Proxy__TrustAll).toBeUndefined();
    expect(env.Database__SslMode).toBe("VerifyFull");
    expect(env.Web__RevalidateFanOut).toBe("true");
    for (const name of Object.keys(env)) expect(name).not.toMatch(/Password|Secret|Key$/);
    const secrets = (api.Secrets as Array<{ Name: string }>).map((s) => s.Name);
    expect(secrets).toEqual(expect.arrayContaining(["Database__Passwords__App", "Payments__SecretsKey", "Web__RevalidateSecret"]));
    expect(secrets).not.toContain("Database__Passwords__Admin");
  });
  it("roll back failed deployments and register every task in service discovery", () => {
    prod.services.resourcePropertiesCountIs("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({ DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100 }),
      NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "DISABLED" }) },
    }, 2);
    prod.services.resourcePropertiesCountIs("AWS::ServiceDiscovery::Service", { DnsConfig: Match.objectLike({ DnsRecords: [{ Type: "A", TTL: 10 }] }) }, 2);
  });
  it("use the per-environment web image", () => {
    const web = containers(staging.services).find((c) => c.Name === "web")!;
    expect(JSON.stringify(web.Image)).toContain(":0123abc-staging");
  });
  it("runs deploy-db as a one-off task with the admin credentials only there", () => {
    const task = containers(prod.migrate).find((c) => c.Name === "deploy-db")!;
    expect(task.Command).toEqual(["deploy-db"]);
    expect((task.Secrets as Array<{ Name: string }>).map((s) => s.Name)).toEqual(
      expect.arrayContaining(["Database__Passwords__Admin", "Database__AdminUsername", "Database__Passwords__Migrations"]));
  });
  it("alarm on 5xx rate, unhealthy tasks, latency and error logs", () => {
    const names = [prod.core, prod.services].flatMap((t) => Object.values(t.findResources("AWS::CloudWatch::Alarm")).map((a) => a.Properties.AlarmDescription as string));
    for (const expected of [/5xx/, /unhealthy task/, /p95 latency/, /errors logged/, /Database CPU/, /free storage/])
      expect(names.some((n) => expected.test(n))).toBe(true);
  });
});

describe("deploy role", () => {
  it("can only be assumed from the matching GitHub environment", () => {
    prod.foundation.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({
          Condition: { StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": "repo:yash-mudgal/E-Commerce-MockUI:environment:production",
          } },
        })],
      },
    });
    prod.foundation.resourceCountIs("AWS::ECR::Repository", 2);
    prod.foundation.hasResourceProperties("AWS::ECR::Repository", { ImageTagMutability: "IMMUTABLE", ImageScanningConfiguration: { ScanOnPush: true } });
  });
});
