#!/usr/bin/env node
/**
 * Prints the monthly cost estimate for staging and production as Markdown (docs/COST_REVIEW.md).
 *   npm run cost                          default launch-stage usage (lib/cost.ts DEFAULT_USAGE)
 *   npm run cost -- --usage usage.json    override usage, e.g. {"production": {"pageViews": 5000000}}
 * Synthesises the CDK app with placeholder account values; nothing is deployed and no AWS call is made.
 */
import { App } from "aws-cdk-lib";
import { readFileSync } from "node:fs";
import { DEFAULT_USAGE, estimate, inventoryFrom, PRICE_SOURCE, toMarkdown, type Usage } from "../lib/cost";
import { buildApp } from "./shopmint";

type Env = "staging" | "production";

export function placeholderContext(env: Env) {
  return {
    env,
    account: "000000000000",
    certificateArnGlobal: "arn:aws:acm:us-east-1:000000000000:certificate/placeholder",
    certificateArnRegional: "arn:aws:acm:ap-south-1:000000000000:certificate/placeholder",
    alarmEmail: "placeholder@example.com",
    cloudFrontPrefixListId: "pl-placeholder",
    monthlyBudgetUsd: "1",
    imageTag: "cost-estimate",
  };
}

export function estimateFor(env: Env, overrides: Partial<Usage> = {}) {
  const assembly = buildApp(new App({ context: placeholderContext(env) })).synth();
  return estimate(inventoryFrom(assembly), { ...DEFAULT_USAGE[env], ...overrides });
}

if (require.main === module) {
  const i = process.argv.indexOf("--usage");
  const overrides: Partial<Record<Env, Partial<Usage>>> = i > 0 ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : {};
  const out = (["staging", "production"] as const).map((env) => toMarkdown(env, estimateFor(env, overrides[env])));
  console.log(`Prices: AWS Price List, on-demand USD, retrieved ${PRICE_SOURCE.retrieved}. Before tax (18% GST on Indian accounts).\n`);
  console.log(out.join("\n\n"));
}
