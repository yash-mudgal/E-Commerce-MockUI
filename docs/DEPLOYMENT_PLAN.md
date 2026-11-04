# Deployment Plan

## Environments

| Env | Purpose | Data | Payments |
|---|---|---|---|
| local | docker-compose: postgres, media (moto S3 server), mailpit (+ api and web, or run them natively) | Seeded fixtures | Razorpay test keys or a stub |
| staging | Production-like; every merge to `main` deploys automatically | Synthetic only, **never** production copies | Razorpay test mode |
| production | Tagged releases with manual approval | Real | Razorpay live |

Configuration is environment variables only (12-factor). `appsettings.json` contains non-secret defaults;
`.env.example` documents every variable.

## Reference production topology (AWS ap-south-1, Mumbai)

Implemented in `infra/` (AWS CDK; ADR-039 to ADR-042):

```
DNS ─► CloudFront app.shopmint.in, *.shopmint.in (TLS 1.2+, WAF, edge function) ──origin header──►
       ALB origin.shopmint.in (CloudFront IP ranges only; 403 without the header)
         ├─ /api/*  ─► ECS Fargate: api (2–6 tasks)  ─► RDS PostgreSQL 16 (Multi-AZ, TLS, PITR 35 d) in isolated subnets
         └─ else    ─► ECS Fargate: web (2–8 tasks)  ─► api.shopmint.internal (service discovery)
       CloudFront media.shopmint.in ─► S3 media bucket (OAC; browsers upload with presigned PUTs)
Secrets Manager · SES (SMTP) · CloudWatch logs, alarms (SNS), dashboard · AWS Backup → ap-south-2 vault
```

Background jobs (email outbox, billing, order expiry, notifications) run inside the API tasks and are safe with several
instances (row locks); a separate worker service isn't needed yet.

**Why this and not Kubernetes:** a small team, three services and predictable load. Fargate removes node
management. Costs: see the usage model in `COST_REVIEW.md` (priced in the AWS calculator before launch). Revisit the
platform choice at roughly 50 tasks.

**Custom domains:** the merchant adds a CNAME to `stores.shopmint.in` and proves ownership with a TXT
record. The platform requests an ACM certificate (or uses CloudFront's SaaS multi-tenant distributions)
and marks the `tenant_domains` row verified.

## CI/CD (GitHub Actions)

1. **PR** (`.github/workflows/ci.yml`): `api` job (build with warnings as errors, tests on PostgreSQL), `web` job (lint, type-check, test, build), `infra` job (type-check, CDK assertion tests, synth of both environments), `secrets` job (gitleaks), `e2e` job (whole stack: every browser walkthrough, axe, ZAP baseline, load test).
2. **Merge to main → staging** (`.github/workflows/deploy.yml`): assume the environment's deploy role (OIDC, no stored keys) → API image tagged with the git SHA (built once) → Edge/Dr/Core stacks → web image for the environment → Migrate stack and the `deploy-db` one-off task (must exit 0) → Services stack (rolling, circuit-breaker rollback) → `ops/smoke.cjs --edge`.
3. **Tag `v*` → production:** required reviewers approve the `production` environment, then the same steps with the same API image.
4. **Rollback:** run the workflow with `rollback_to=<earlier sha>`: services only, no migrations (`docs/runbooks/deploy-and-rollback.md`).

Deployments stay off until the repository variable `DEPLOY_ENABLED` is `true` (`docs/runbooks/first-deploy.md`).
Dockerfiles exist for both apps (`apps/api/Dockerfile`, `apps/web/Dockerfile`, Next.js `standalone` output). Both run as non-root.

**Proxy trust:** the Next.js server calls the API directly (service discovery) for storefront rendering and passes
the shopper's host in `X-Forwarded-Host`; browsers reach `/api/*` through CloudFront and the load balancer. The API
trusts forwarded headers only from the VPC (`Proxy__KnownNetworks__0`), CloudFront's edge function removes any
`X-Forwarded-Host` a browser sends, and the client IP comes from `X-ShopMint-Client-Ip` (`Proxy__ClientIpHeader`),
which the edge function overwrites. `Proxy__TrustAll` is for local and compose use only; Production refuses it.

## Product media (S3)

- **Bucket:** private bucket `shopmint-media-<env>` in ap-south-1, served through CloudFront with Origin Access Control
  (`Media__PublicBaseUrl` = the CloudFront URL). Keys are `t/<tenant>/p/<product>/<random>.<ext>`.
- **Uploads:** browsers PUT directly to S3 with presigned URLs, so the bucket needs a CORS rule allowing `PUT` with
  the `Content-Type` header from the app and storefront origins. The API needs `s3:PutObject` (to presign),
  `s3:GetObject` and `s3:DeleteObject` on `t/*` via the task role (no static keys in AWS).
- **Web:** set `MEDIA_PUBLIC_URL` at build time to the CloudFront URL so Next.js can resize product images, and
  `MEDIA_UPLOAD_ORIGIN` to the bucket's upload origin (e.g. `https://shopmint-media-prod.s3.ap-south-1.amazonaws.com`).
  Both are build arguments of `apps/web/Dockerfile` because the Content-Security-Policy is fixed at build time; a
  wrong value makes image display or uploads fail with a CSP error in the browser console. For local hosts
  image optimisation is switched off automatically.
- **Local:** docker-compose runs moto's S3 server as `media` (`media-init` creates the bucket). MinIO stopped publishing
  images to Docker Hub in 2025, and moto is what the upload tests were verified against. The API signs uploads for
  `http://localhost:9000` (`Media__PublicServiceUrl`) while it talks to `http://media:5000` itself. Moto keeps objects
  in memory: uploaded images disappear when the container restarts.

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
- With several web tasks, each keeps its own cache. In AWS the API resolves `web.shopmint.internal` (one A record per
  task) and calls every task (`Web__RevalidateFanOut=true`). A shared cache handler (Redis/Valkey) is an alternative if
  the task count grows large.

## Security settings (Phase 11)

- **Session keys** live in the `data_protection_keys` table (created by the `Phase11Security` migration), so all API
  tasks share them and redeploys don't sign anyone out. Deleting the table's rows signs everyone out.
- **Two-step secrets** are encrypted with `Payments__SecretsKey`; losing that key also disables every user's
  authenticator (they'd need an operator reset). Back it up in Secrets Manager with the other keys.
- Never set `Seed:*` values in staging or production (the demo admin's authenticator key is development-only).
- Every platform admin enrols two-step verification on first sign-in; platform tools stay closed until they do.
- Rate limits: `RateLimiting__AuthPerMinute` (default 10 per IP; CI's E2E job raises it because all browsers share one
  IP) and `RateLimiting__CheckoutPerMinute`. Keep the defaults in production.
- Request bodies are capped at 1 MB by Kestrel; the load balancer may use a lower limit for `/api`.

## Migrations and rollback

- Migrations follow expand/contract: additive first, deploy code, then remove old columns in a later release. This keeps the previous app version compatible, so a **rollback is redeploying the previous image** without reverting the schema.
- The release image's `deploy-db` command runs as a one-off ECS task before the rollout (ADR-041). If it fails, the deploy aborts and the running version is untouched. `verify-db` checks a database after a restore.

## Observability

- Health: `/health/live` for the ECS container check, `/health/ready` for the ALB target group.
- Alerts: 5xx rate above 1% for 5 minutes, p95 latency, database CPU and connections, outbox backlog older than 5 minutes, webhook failures, payment success rate drop.
- Implemented alarms (SNS email): availability SLO burn-rate alarms (fast: 14.4× over 1 h and 5 min; slow: 6× over 6 h and 30 min; `SLO.md`), unhealthy API/web tasks, API p95 above 800 ms, page p95 above 1 s, more than 20 API error logs in 5 minutes, database CPU/memory/connections/storage, service CPU/memory. Dashboard `shopmint-<env>` (with the SLO view). AWS Budgets emails at 80% of actual spend and when the forecast passes the budget (`monthlyBudgetUsd`, `COST_REVIEW.md`).
- Runbooks: `docs/runbooks/` (first deploy, deploy and rollback, one-off operator tasks, restore, secret rotation, incident response, two-step reset).

## Disaster recovery

RPO 15 minutes (PITR, 5-minute granularity), RTO 4 hours. AWS Backup takes daily snapshots of the database and the
media bucket and copies them to a locked vault in ap-south-2 (Hyderabad), so copies stay in India (DPDP Act).
A restore drill each quarter (`docs/runbooks/restore.md`); the logical-backup path is rehearsed locally with
`ops/restore-drill-local.sh`.
