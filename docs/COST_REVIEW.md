# Cost Review

**Status: priced estimate, 2026-11-04. Not a bill.** ShopMint hasn't run on AWS yet. The numbers below combine:

- **What gets created**, read from the synthesised CDK templates (`infra/lib/cost.ts` → `inventoryFrom`), so the
  estimate follows infrastructure changes.
- **AWS list prices** for Asia Pacific (Mumbai) from the AWS Price List bulk API, on-demand, in USD, retrieved
  2026-11-04. Each price is in `infra/lib/cost.ts` (`PRICES`) with its usage type; the price-file versions are in
  `PRICE_SOURCE`. CloudFront WAF prices are us-east-1, and backup copies are priced for ap-south-2. The CloudWatch
  dashboard price isn't in the price list; it comes from the CloudWatch pricing page.
- **Usage assumptions** for a launch-stage month (`DEFAULT_USAGE`), stated below. These are guesses until there is
  real traffic.

No free tier, credits, savings plans or taxes are applied. AWS bills Indian accounts with 18% GST on top.

Regenerate after changing infrastructure or assumptions:

```bash
cd infra && npm run cost
```

Pass different usage with `npm run cost -- --usage usage.json`, for example `{"production": {"pageViews": 5000000}}`.

## Suggested budgets

| Environment | Estimate (before tax) | Of which fixed | Suggested `MONTHLY_BUDGET_USD` |
|---|---:|---:|---:|
| Staging | ~$218 | ~$204 | **300** |
| Production | ~$838 | ~$652 | **1050** |

The suggestion is the estimate plus 20% headroom, rounded up to the next $50 (`suggestedBudget`). The AWS Budgets
budget excludes tax, credits and refunds (`costTypes` in `core-stack.ts`), so it compares directly with these figures.
Budget emails go out at 80% of actual spend and when the month's forecast passes 100%.

**Most of the cost is fixed.** About 78% of production and 94% of staging is paid whether or not anyone visits. The
production database (db.m7g.large Multi-AZ, ~$350) alone is 42% of the production estimate.

## Usage assumptions (launch stage)

| Assumption | Staging | Production | Why |
|---|---:|---:|---|
| Storefront page views a month | 20,000 | 2,000,000 | About 0.8 pages/s on average; one web task serves ~70/s (Phase 11) |
| App requests per page view (after browser caching) | 6 | 6 | HTML, RSC payloads, uncached scripts, API calls |
| App data per page view | 150 KB | 150 KB | Storefront HTML is ~80 KB (Phase 11) plus RSC and scripts |
| Images per page view / data | 4 / 240 KB | 4 / 240 KB | Product grid thumbnails |
| Media share that misses CloudFront | 20% | 5% | |
| Media stored / changed a day | 5 GB / 0.05 GB | 50 GB / 0.5 GB | |
| Database data / changed a day | 2 GB / 0.05 GB | 10 GB / 0.3 GB | Drives snapshot copies |
| Extra task-hours from autoscaling (per service) | 20 | 200 | Peaks above the desired count |
| Load balancer capacity units (average) | 0.2 | 1 | |
| Logs a month: app + database / VPC flow / ALB | 3.5 / 1 / 0.5 GB | 17 / 5 / 10 GB | |
| Other NAT data (Razorpay, SES, Secrets Manager) | 3 GB | 10 GB | Image layers use the free S3 gateway endpoint |
| Cross-AZ traffic | 5 GB | 50 GB | Tasks ↔ database |
| Emails a month | 2,000 | 50,000 | Orders, invitations, digests |
| Container Insights observations per task-minute | 100 | 100 | Not a published figure: **measure in week one** |
| Database CPU above the t4g baseline | 20 vCPU-h | — | Staging only (burstable class) |

## Estimate

### Staging

| Group | Item | Basis | Kind | USD/month |
|---|---|---|---|---:|
| Compute | Fargate api | 1 × 0.5 vCPU / 1 GB × 730 h | fixed | 18.93 |
| Compute | Fargate api, autoscaling peaks | 20 extra task-hours | usage | 0.52 |
| Compute | Fargate web | 1 × 1 vCPU / 2 GB × 730 h | fixed | 37.87 |
| Compute | Fargate web, autoscaling peaks | 20 extra task-hours | usage | 1.04 |
| Compute | Fargate deploy-db task | 40 releases × 5 min | usage | 0.09 |
| Database | RDS db.t4g.medium | 730 h × $0.084 | fixed | 61.32 |
| Database | RDS gp3 storage | 20 GB provisioned | fixed | 2.62 |
| Database | RDS CPU credits (burst above baseline) | 20 vCPU-h | usage | 1.50 |
| Database | Database Insights (Standard), conservative | 2 vCPU × 730 h; may be free at 7-day retention | fixed | 3.37 |
| Database | Backup storage, main region | ~4 GB vs 20 GB free | usage | 0.00 |
| Database | Backup copies in ap-south-2 | ~3 GB snapshot storage | usage | 0.26 |
| Database | Backup copy transfer to ap-south-2 | ~1.5 GB incremental a month | usage | 0.13 |
| Network | NAT gateways × 1 | 1 × 730 h | fixed | 40.88 |
| Network | NAT data processed | 7 GB (logs + external APIs) | usage | 0.36 |
| Network | Application Load Balancer | 1 × 730 h | fixed | 17.45 |
| Network | ALB capacity units | 0.2 LCU average × 730 h | usage | 1.17 |
| Network | Cross-AZ traffic | 5 GB × 2 directions | usage | 0.10 |
| Network | Cloud Map (private DNS + task records) | 1 zone, 2 records | fixed | 0.70 |
| Edge | CloudFront data to shoppers | 7 GB (India) | usage | 0.81 |
| Edge | CloudFront HTTPS requests | 0.2 M | usage | 0.24 |
| Edge | CloudFront Function (app viewer requests) | 0.1 M | usage | 0.01 |
| Edge | WAF web ACL and rules | 1 ACL + 6 rules | fixed | 11.00 |
| Edge | WAF requests (app distribution) | 0.1 M | usage | 0.07 |
| Storage and backup | S3 media | 5 GB + old versions (30 days) | usage | 0.16 |
| Storage and backup | S3 requests | 1,000 uploads, 0.02 M origin reads | usage | 0.01 |
| Storage and backup | S3 load balancer logs | 1 GB/month × 30 days | usage | 0.01 |
| Storage and backup | AWS Backup of media (both regions) | ~7 + 6 GB warm | usage | 0.81 |
| Storage and backup | ECR images | 10 GB | usage | 1.00 |
| Observability | CloudWatch Logs ingestion | 3.5 GB app/database + 1 GB flow logs | usage | 3.02 |
| Observability | CloudWatch Logs storage | 30 days retained | usage | 0.14 |
| Observability | CloudWatch alarms | 29 alarm metrics + 2 composite | fixed | 3.90 |
| Observability | CloudWatch dashboard and custom metrics | 1 dashboard, 1 metric filter | fixed | 3.30 |
| Observability | Container Insights (enhanced) | ~9 M observations (assumed 100/task/min) | usage | 1.89 |
| Other | Secrets Manager | 6 created + 1 operator secret | fixed | 2.80 |
| Other | SES email | 2,000 emails | usage | 0.20 |
| | **Fixed (doesn't move with traffic)** | | | **204.13** |
| | **Usage-based (assumptions)** | | | **13.54** |
| | **Total, before tax** | | | **217.66** |
| | **Suggested `MONTHLY_BUDGET_USD`** (total + 20%, rounded up to $50) | | | **300** |

### Production

| Group | Item | Basis | Kind | USD/month |
|---|---|---|---|---:|
| Compute | Fargate api | 2 × 1 vCPU / 2 GB × 730 h | fixed | 75.73 |
| Compute | Fargate api, autoscaling peaks | 200 extra task-hours | usage | 10.37 |
| Compute | Fargate web | 2 × 1 vCPU / 2 GB × 730 h | fixed | 75.73 |
| Compute | Fargate web, autoscaling peaks | 200 extra task-hours | usage | 10.37 |
| Compute | Fargate deploy-db task | 20 releases × 5 min | usage | 0.04 |
| Database | RDS db.m7g.large Multi-AZ | 730 h × $0.479 | fixed | 349.67 |
| Database | RDS gp3 storage | 100 GB provisioned | fixed | 26.20 |
| Database | Database Insights (Standard), conservative | 2 vCPU × 730 h; may be free at 7-day retention | fixed | 3.37 |
| Database | Backup storage, main region | ~21 GB vs 100 GB free | usage | 0.00 |
| Database | Backup copies in ap-south-2 | ~37 GB snapshot storage | usage | 3.52 |
| Database | Backup copy transfer to ap-south-2 | ~9 GB incremental a month | usage | 0.77 |
| Network | NAT gateways × 2 | 2 × 730 h | fixed | 81.76 |
| Network | NAT data processed | 27 GB (logs + external APIs) | usage | 1.51 |
| Network | Application Load Balancer | 1 × 730 h | fixed | 17.45 |
| Network | ALB capacity units | 1 LCU average × 730 h | usage | 5.84 |
| Network | Cross-AZ traffic | 50 GB × 2 directions | usage | 1.00 |
| Network | Cloud Map (private DNS + task records) | 1 zone, 4 records | fixed | 0.90 |
| Edge | CloudFront data to shoppers | 744 GB (India) | usage | 81.08 |
| Edge | CloudFront HTTPS requests | 20 M | usage | 24.00 |
| Edge | CloudFront Function (app viewer requests) | 12 M | usage | 1.20 |
| Edge | WAF web ACL and rules | 1 ACL + 6 rules | fixed | 11.00 |
| Edge | WAF requests (app distribution) | 12 M | usage | 7.20 |
| Storage and backup | S3 media | 50 GB + old versions (30 days) | usage | 1.63 |
| Storage and backup | S3 requests | 20,000 uploads, 0.4 M origin reads | usage | 0.26 |
| Storage and backup | S3 load balancer logs | 10 GB/month × 90 days | usage | 0.75 |
| Storage and backup | AWS Backup of media (both regions) | ~68 + 95 GB warm | usage | 10.23 |
| Storage and backup | ECR images | 10 GB | usage | 1.00 |
| Observability | CloudWatch Logs ingestion | 17 GB app/database + 5 GB flow logs | usage | 14.74 |
| Observability | CloudWatch Logs storage | 90 days retained | usage | 1.98 |
| Observability | CloudWatch alarms | 29 alarm metrics + 2 composite | fixed | 3.90 |
| Observability | CloudWatch dashboard and custom metrics | 1 dashboard, 1 metric filter | fixed | 3.30 |
| Observability | Container Insights (enhanced) | ~19.9 M observations (assumed 100/task/min) | usage | 4.18 |
| Other | Secrets Manager | 6 created + 1 operator secret | fixed | 2.80 |
| Other | SES email | 50,000 emails | usage | 5.00 |
| | **Fixed (doesn't move with traffic)** | | | **651.80** |
| | **Usage-based (assumptions)** | | | **186.68** |
| | **Total, before tax** | | | **838.48** |
| | **Suggested `MONTHLY_BUDGET_USD`** (total + 20%, rounded up to $50) | | | **1050** |

## What moves the total

- **Traffic** mainly moves CloudFront. Each extra million page views adds about $57 in production: data ~$41,
  requests ~$12, WAF ~$3.6, function ~$0.6. Above ~70 pages/s sustained, add web tasks at ~$38 per task-month.
- **Data size** moves backups and S3 slowly: about $0.10 per GB-month for database copies, $0.14 per GB-month for
  media (stored once, backed up in both regions).
- **Logs** cost $0.67 per GB ingested. A noisy log level is the easiest way to overspend.

## Levers if costs need to come down

Savings are computed from the same price files, for the production estimate unless noted.

| Lever | Saving a month | Trade-off |
|---|---:|---|
| Production database db.t4g.large Multi-AZ ($0.334/h) instead of db.m7g.large ($0.479/h) | ~$106 | Burstable: CPU credits above the baseline are billed. Watch `CPUCreditBalance`; fine for a small first fleet |
| Graviton (ARM64) Fargate ($0.02383 vCPU-h, $0.00261 GB-h vs $0.04256 / $0.004655) | ~$67 (production), ~$25 (staging) | Build multi-arch images in CI; test the .NET and Node images on ARM |
| One NAT gateway in production | ~$41 | One AZ outage also stops outbound calls (Razorpay, SES) |
| Compute Savings Plan / RDS reserved instance (1 year) | Large share of the baseline | Commitment; decide after 2–3 months of real usage |
| Fargate Spot for staging | Most of staging compute | Tasks can be interrupted |
| Scale staging to zero outside working hours | Part of ~$57 staging compute | Deploys and smoke tests outside hours must start it |
| VPC interface endpoints (ECR, Secrets Manager, CloudWatch Logs) | None at this scale | $0.013 per endpoint-hour per AZ (~$57 a month for three in two AZs) against ~$1.50 of NAT data. Revisit above ~1 TB of NAT data a month |
| Shorter log retention, lower log level | Part of CloudWatch | Less history during incidents |

## Controls in place

- **AWS Budgets** per environment (`monthlyBudgetUsd`, required at deploy). Use one AWS account per environment so
  each budget covers exactly one environment (the us-east-1 WAF and ap-south-2 backup vault are in the same account).
- Cost allocation tags on every resource: `shopmint:environment`, `shopmint:managed-by`. Activate them in the
  Billing console to see cost per environment.
- Log retention (30/90 days), S3 lifecycle rules (old image versions, incomplete uploads, ALB logs), ECR lifecycle.
- Staging is single-AZ for the database, with one NAT gateway and minimum task sizes.

## Review cadence

Monthly with the operating review (`OPERATING_REVIEW.md`). Compare actual spend per service in Cost Explorer with the
lines above. After the first month, replace `DEFAULT_USAGE` with measured values: page views, CloudFront GB, log GB,
observations. Re-run `npm run cost` and adjust the budget. Each quarter, refresh `PRICES` from the price list (check
the offer versions in `PRICE_SOURCE`).
