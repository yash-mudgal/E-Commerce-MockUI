# Rotate a secret

Every secret lives in AWS Secrets Manager and reaches containers as an environment variable when a task **starts**.
After changing one, restart the affected service so new tasks pick it up:

```bash
aws ecs update-service --cluster shopmint-$ENV --service api --force-new-deployment   # or: web
```

If a secret leaked: rotate it first, then investigate (CloudTrail for Secrets Manager reads, the activity log, the
API logs). Never paste secret values into tickets, chat or logs.

| Secret | Where | How to rotate | Effect |
|---|---|---|---|
| Database role passwords (`DbOwnerPassword`, `DbAppPassword`, `DbPlatformPassword`) | Core stack secrets | Put a new value in the secret, run the release's `deploy-db` (it sets role passwords from the secrets), then restart `api` | Brief connection errors between the two steps; do it in a quiet hour |
| RDS master (`shopmint_master`) | RDS-managed secret | `aws rds modify-db-instance --manage-master-user-password --rotate-master-user-password` or a new value + `deploy-db` | Used only by `deploy-db` |
| `revalidateSecret` (storefront cache refresh) | Core stack secret | New value in the secret, then restart **both** `web` and `api` | Refreshes fail between restarts; pages still expire on their own |
| `originSecret` (CloudFront → load balancer) | Core stack secret | Change requires a CDK deploy of Core and Services (CloudFront and the listener rules read it at deploy time) | Traffic is refused while the two disagree: deploy both in one run |
| `billingRazorpay*` | `shopmint/$ENV/app` | New key in the Razorpay Dashboard → update the secret → restart `api` → revoke the old key; for the webhook secret, update it in Razorpay at the same time | Subscription checkout/webhooks fail between the steps |
| `smtpUsername` / `smtpPassword` | `shopmint/$ENV/app` | New SES SMTP credentials → update → restart `api` → delete the old IAM key | Mail queues in the outbox meanwhile and is retried |
| `paymentsSecretsKey` | `shopmint/$ENV/app` | **No in-place rotation yet**: changing it makes every stored merchant Razorpay secret and every two-step secret unreadable. If it leaked, treat as an incident: build the re-encryption job, or set a new key and ask merchants to reconnect Razorpay and users to re-enrol two-step | Severe; avoid |
| Session keys (`data_protection_keys`) | Database | Rotated automatically every 90 days by ASP.NET Core. To revoke all sessions now: delete the rows (platform role) and restart `api` | Everyone is signed out |
| Merchant Razorpay keys | Encrypted in the database | The merchant reconnects in Store settings → Payments | Only that store |
| GitHub deploy role | IAM (Foundation stack) | No long-lived credentials exist (OIDC); to cut access, remove the trust policy or the GitHub environment | — |

The RDS CA bundle in `apps/api/certs/` isn't a secret. Refresh it from AWS when they announce new CAs.
