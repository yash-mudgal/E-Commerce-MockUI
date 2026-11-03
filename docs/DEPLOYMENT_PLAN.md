# Deployment Plan

## Environments

| Env | Purpose | Data | Payments |
|---|---|---|---|
| local | docker-compose: postgres, minio, mailpit (+ api and web, or run them natively) | Seeded fixtures | Razorpay test keys or a stub |
| staging | Production-like; every merge to `main` deploys automatically | Synthetic only, **never** production copies | Razorpay test mode |
| production | Tagged releases with manual approval | Real | Razorpay live |

Configuration is environment variables only (12-factor). `appsettings.json` contains non-secret defaults;
`.env.example` documents every variable.

## Reference production topology (AWS ap-south-1, Mumbai)

```
Route 53 ─► CloudFront (TLS, WAF, *.shopmint.in + custom domains via ACM)
            ├─► ALB ─► ECS Fargate: web (Next.js, 2+ tasks)
            │          ECS Fargate: api (2+ tasks)  ─► RDS PostgreSQL (Multi-AZ, PITR 35d)
            │          ECS Fargate: worker (1+)     ─► S3 (media, invoices)  ─► SES
            └─► S3 media bucket (OAC)
Secrets Manager · CloudWatch logs/metrics/alarms · OpenTelemetry → (Grafana Cloud or CloudWatch)
```

**Why this and not Kubernetes:** a small team, three services and predictable load. Fargate removes node
management. Estimated cost at launch is about US$250–400 a month. Revisit at roughly 50 tasks.

**Custom domains:** the merchant adds a CNAME to `stores.shopmint.in` and proves ownership with a TXT
record. The platform requests an ACM certificate (or uses CloudFront's SaaS multi-tenant distributions)
and marks the `tenant_domains` row verified.

## CI/CD (GitHub Actions)

1. **PR:** `api` job (restore, build with warnings as errors, test against a PostgreSQL service container), `web` job (install, lint, type-check, test, build), secret scan.
2. **Merge to main:** build and push images tagged with the git SHA to ECR → run the migration task (EF bundle as `shopmint_owner`) → rolling ECS deploy to staging → smoke tests.
3. **Release tag:** manual approval → same images to production.

Steps 2 and 3 are documented here and will be implemented in Phase 12. Step 1 is in `.github/workflows/ci.yml`.
Dockerfiles exist for both apps (`apps/api/Dockerfile`, `apps/web/Dockerfile`, Next.js `standalone` output). Both run as non-root.

**Proxy trust:** the Next.js server calls the API directly for storefront rendering and passes the shopper's host
in `X-Forwarded-Host`. In production, set `Proxy__KnownNetworks__0` to the private subnet of the web tasks so
only they can assert a host. `Proxy__TrustAll` is for local and compose use only.

## Migrations and rollback

- Migrations follow expand/contract: additive first, deploy code, then remove old columns in a later release. This keeps the previous app version compatible, so a **rollback is redeploying the previous image** without reverting the schema.
- `dotnet ef migrations bundle` produces a self-contained migrator, run as a one-off ECS task before the rollout. If it fails, the deploy aborts.

## Observability

- Health: `/health/live` for the ECS container check, `/health/ready` for the ALB target group.
- Alerts: 5xx rate above 1% for 5 minutes, p95 latency, database CPU and connections, outbox backlog older than 5 minutes, webhook failures, payment success rate drop.
- Runbooks (Phase 12): restore from PITR, rotate a leaked secret, suspend an abusive tenant, replay a webhook.

## Disaster recovery

RPO 15 minutes (PITR), RTO 4 hours. Cross-region snapshot copy weekly. A restore drill each quarter.
