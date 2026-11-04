# Cost Review

**Status: usage model only, not priced.** This document lists what each environment runs, from the CDK
configuration (`infra/lib/config.ts`), so it can be priced in the
[AWS Pricing Calculator](https://calculator.aws/) for the Asia Pacific (Mumbai) region. It doesn't quote prices:
they change, and no real bill exists yet. An earlier planning estimate in `DEPLOYMENT_PLAN.md` (US$250–400 a month)
had no source and has been removed.

## Usage model (per month, about 730 hours)

| Resource | Staging | Production | Scales with |
|---|---|---|---|
| ECS Fargate, API (x86) | 1 task × 0.5 vCPU / 1 GB (max 2) → 365 vCPU-h, 730 GB-h | 2 tasks × 1 vCPU / 2 GB (max 6) → 1,460 vCPU-h, 2,920 GB-h | Traffic (CPU autoscaling at 60%) |
| ECS Fargate, web (x86) | 1 task × 1 vCPU / 2 GB (max 2) → 730 vCPU-h, 1,460 GB-h | 2 tasks × 1 vCPU / 2 GB (max 8) → 1,460 vCPU-h, 2,920 GB-h | Storefront traffic (~70 pages/s per vCPU, Phase 11) |
| One-off tasks (`deploy-db`) | 0.5 vCPU / 1 GB, minutes per release | Same | Releases |
| RDS PostgreSQL 16 | db.t4g.medium, single-AZ, 20–100 GB gp3 | db.m7g.large **Multi-AZ** (two instances billed), 100–1,000 GB gp3 | Data size (storage autoscaling) |
| RDS backup storage | 7 days PITR | 35 days PITR (free up to the database size, then per GB) | Write volume |
| RDS Performance Insights, enhanced monitoring | On | On | Instance count |
| NAT gateways | 1 (hourly + per GB processed) | 2 | Outbound traffic: Razorpay, SES, ECR pulls (S3 uses the free gateway endpoint) |
| Application Load Balancer | 1 (hourly + LCUs) | 1 | Requests, connections |
| CloudFront (app + media) | Requests and data out, Price Class 200 (includes India) | Same | Shoppers and images |
| AWS WAF | 1 web ACL, 6 rules, per million requests | Same | Requests |
| S3 | Media (versioned, old versions kept 30 days), ALB logs (30/90 days) | Same | Images, traffic |
| AWS Backup | Daily snapshots kept 35 days + copies in ap-south-2 (14 days) | Copies kept 90 days | Database and media size; cross-region transfer |
| CloudWatch | Logs (30 days), Container Insights, 19 alarms (17 metric, 2 composite), 1 dashboard | Logs (90 days), same | Log volume |
| Secrets Manager | 7 secrets (6 created by the Core stack, 1 entered by an operator) | Same | — |
| SES | Per 1,000 emails | Same | Orders, invitations, digests |
| ECR | Images, last 100 tags kept | Same | Releases |

Biggest fixed costs, in likely order: RDS Multi-AZ, Fargate baseline tasks, NAT gateways, then the ALB. Biggest
variable costs: CloudFront and NAT data, WAF requests, CloudWatch logs.

## Controls in place

- **AWS Budgets** per environment (`monthlyBudgetUsd`, required at deploy): email at 80% of actual spend and when the
  month's forecast exceeds 100%. Use one AWS account per environment so each budget covers exactly one environment.
- Cost allocation tags on every resource: `shopmint:environment`, `shopmint:managed-by` (activate them in the
  Billing console to see cost per environment).
- Log retention (30/90 days), S3 lifecycle rules (old image versions, incomplete uploads, ALB logs), ECR lifecycle.
- Staging is single-AZ with one NAT gateway and minimum task sizes.

## How to set the budget (before the first deployment)

1. Enter the production column above in the AWS Pricing Calculator (Mumbai), plus traffic assumptions: e.g. 2 million
   page views and 20 GB of images served a month for the first stores.
2. Set `MONTHLY_BUDGET_USD` in each GitHub environment to the estimate plus 20% headroom.
3. Record the estimate and its assumptions here, with the date.

## Levers if costs need to come down

| Lever | Saving | Trade-off |
|---|---|---|
| Graviton (ARM64) Fargate tasks | Lower vCPU-hour price | Build multi-arch images in CI |
| Fargate Spot for staging | Large discount on staging compute | Tasks can be interrupted |
| Compute Savings Plan / RDS reserved instance (1 year) | Large discount on steady baseline | Commitment; do it after 2–3 months of real usage |
| VPC interface endpoints (ECR, Secrets Manager, CloudWatch Logs) | Less NAT data processing | Endpoint hourly charges; worth it only at volume |
| Scale staging to zero outside working hours | Staging compute | Deploys and smoke tests outside hours must start it |
| Shorter log retention, lower log level | CloudWatch | Less history during incidents |

## Review cadence

Monthly with the operating review (`OPERATING_REVIEW.md`): actual spend against budget per service in Cost Explorer,
anomalies, and whether any lever above is now worth pulling. Each quarter, refresh the usage model from the config.
