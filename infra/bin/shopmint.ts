#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import { imageTag, loadConfig } from "../lib/config";
import { CoreStack } from "../lib/core-stack";
import { DrStack } from "../lib/dr-stack";
import { EdgeStack } from "../lib/edge-stack";
import { FoundationStack } from "../lib/foundation-stack";
import { MigrateStack } from "../lib/migrate-stack";
import { ServicesStack } from "../lib/services-stack";

/**
 * One environment per invocation (-c env=staging|production). Stacks, in deployment order:
 *   Foundation (once, by an admin) → Edge (us-east-1) → Dr (ap-south-2) → Core → Migrate → [run deploy-db] → Services
 * See infra/README.md and docs/runbooks/first-deploy.md.
 */
export function buildApp(app: App): App {
  const config = loadConfig(app.node);
  const prefix = `ShopMint-${config.name}`;
  const env = (region: string) => ({ account: config.account, region });

  new FoundationStack(app, `${prefix}-Foundation`, {
    env: env(config.region),
    config,
    createGithubOidcProvider: app.node.tryGetContext("createGithubOidcProvider") !== "false",
  });
  const edge = new EdgeStack(app, `${prefix}-Edge`, { env: env("us-east-1"), config, crossRegionReferences: true });
  const dr = new DrStack(app, `${prefix}-Dr`, { env: env(config.drRegion), config, crossRegionReferences: true });
  const core = new CoreStack(app, `${prefix}-Core`, {
    env: env(config.region), config, crossRegionReferences: true,
    webAclArn: edge.webAclArn, drVaultArn: dr.vaultArn,
    terminationProtection: config.name === "production",
  });

  // Release stacks need the image tag; skip them when only the long-lived stacks are being synthesised.
  if (app.node.tryGetContext("imageTag") !== undefined) {
    const tag = imageTag(app.node);
    new MigrateStack(app, `${prefix}-Migrate`, { env: env(config.region), config, core, imageTag: tag });
    new ServicesStack(app, `${prefix}-Services`, { env: env(config.region), config, core, imageTag: tag });
  }

  Tags.of(app).add("shopmint:environment", config.name);
  Tags.of(app).add("shopmint:managed-by", "cdk");
  return app;
}

if (require.main === module) buildApp(new App()).synth();
