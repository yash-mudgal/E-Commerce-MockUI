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

## Product media (S3)

- **Bucket:** private bucket `shopmint-media-<env>` in ap-south-1, served through CloudFront with Origin Access Control
  (`Media__PublicBaseUrl` = the CloudFront URL). Keys are `t/<tenant>/p/<product>/<random>.<ext>`.
- **Uploads:** browsers PUT directly to S3 with presigned URLs, so the bucket needs a CORS rule allowing `PUT` with
  the `Content-Type` header from the app and storefront origins. The API needs `s3:PutObject` (to presign),
  `s3:GetObject` and `s3:DeleteObject` on `t/*` via the task role (no static keys in AWS).
- **Web:** set `MEDIA_PUBLIC_URL` at build time to the CloudFront URL so Next.js can resize product images. For local
  hosts (MinIO) image optimisation is switched off automatically.
- **Local:** docker-compose runs MinIO (`minio-init` creates the bucket with public read). The API signs uploads for
  `http://localhost:9000` (`Media__PublicServiceUrl`) while it talks to `http://minio:9000` itself.

## Payments (Razorpay)

- Generate `Payments__SecretsKey` once per environment: 32 random bytes, base64 (`openssl rand -base64 32`). Store it in
  Secrets Manager. **Losing or changing it makes stored merchant keys unreadable**; merchants would have to reconnect.
  Rotating it needs a re-encryption job (not built yet).
- `Payments__AllowTestMode` must be `false` (the default) in production; the API refuses to start otherwise.
- `App__PublicUrl` must be the public HTTPS origin: it forms each store's webhook URL
  (`https://<app>/api/webhooks/razorpay/<storeId>`), which merchants paste into the Razorpay Dashboard.
- **Merchant setup** (shown in Store settings): API keys from Razorpay Dashboard → Account & Settings → API keys; a
  webhook with the store's URL and a secret, events `payment.captured`, `payment.failed`, `order.paid`,
  `refund.processed`, `refund.failed`; and automatic payment capture turned on.
- **Before launch:** on staging, connect a store with Razorpay **test** keys, place an online order, pay with a
  Razorpay test card or UPI ID, and confirm the order is confirmed by both the checkout callback and the webhook
  (the order's payment attempt shows `Captured`; the activity log shows one confirmation). Then refund it.
- The order-expiry job runs inside each API instance; it is safe with several instances (each order is processed under
  a row lock).

## Billing (ShopMint's subscriptions)

- In ShopMint's own Razorpay account: enable Subscriptions, create one monthly plan per public ShopMint plan with the
  amount **including 18% GST** (e.g. Basic ₹1,178.82), and configure GST invoicing for subscription invoices.
- Paste each Razorpay plan ID into Platform → Plans. A public plan without one can't be bought online.
- Set `Billing__Razorpay__KeyId`, `Billing__Razorpay__KeySecret` and `Billing__Razorpay__WebhookSecret` from the secrets
  manager. Without the key pair, billing is unavailable in production (test mode is refused there).
- Add a webhook in that account for `https://<app>/api/webhooks/razorpay-billing` with the same secret and the events
  `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`,
  `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`, `invoice.paid`.
- The billing job runs in each API instance every `Billing__JobIntervalSeconds` (900); work per store is serialised by a
  row lock, so several instances are safe.
- **Before launch:** on staging with test keys, subscribe a trial store (expect "first charge at trial end"), then an
  expired-trial store (expect an immediate charge, an "active" email and a receipt with Razorpay's invoice link).

## Storefront cache refresh and URLs

- Generate one random secret per environment and set it as `REVALIDATE_SECRET` on the web tasks and `Web__RevalidateSecret`
  on the API tasks (Secrets Manager). Set `Web__RevalidateUrl` to the web service's internal URL plus `/internal/revalidate`
  (e.g. `http://web.internal:3000/internal/revalidate`). Don't route `/internal/*` through the public load balancer.
- `STOREFRONT_URL_TEMPLATE` (web) and `Platform__StorefrontUrlTemplate` (API) are `https://{host}` in production; they build
  canonical URLs, sitemaps and shopper email links from the store's registered host.
- With several web tasks, each keeps its own cache: the API's refresh call reaches one task, so set up a shared cache
  handler (Next.js `cacheHandlers`, e.g. Redis/Valkey) or broadcast the call to every task before scaling past one.

## Migrations and rollback

- Migrations follow expand/contract: additive first, deploy code, then remove old columns in a later release. This keeps the previous app version compatible, so a **rollback is redeploying the previous image** without reverting the schema.
- `dotnet ef migrations bundle` produces a self-contained migrator, run as a one-off ECS task before the rollout. If it fails, the deploy aborts.

## Observability

- Health: `/health/live` for the ECS container check, `/health/ready` for the ALB target group.
- Alerts: 5xx rate above 1% for 5 minutes, p95 latency, database CPU and connections, outbox backlog older than 5 minutes, webhook failures, payment success rate drop.
- Runbooks (Phase 12): restore from PITR, rotate a leaked secret, suspend an abusive tenant, replay a webhook.

## Disaster recovery

RPO 15 minutes (PITR), RTO 4 hours. Cross-region snapshot copy weekly. A restore drill each quarter.
