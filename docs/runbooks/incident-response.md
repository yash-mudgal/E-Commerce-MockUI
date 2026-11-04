# Incident response

Alarms go to the SNS topic `ShopMint <env> alarms` (email to `ALARM_EMAIL`; add a pager integration before launch).
Dashboard: CloudWatch → Dashboards → `shopmint-<env>`. Logs: `/shopmint/<env>/api`, `/web`, `/migrate` (JSON; search
with CloudWatch Logs Insights, e.g. `fields @timestamp, Message | filter LogLevel = "Error" | sort @timestamp desc`).

## First five minutes

1. Acknowledge the alarm in the team channel; one person leads.
2. Did something just change? Check the last Deploy workflow run. If the problem started with it, **roll back first**
   ([deploy-and-rollback.md](deploy-and-rollback.md)), investigate after.
3. Is it one store or everyone? Check the 5xx and latency graphs, then logs filtered by tenant ID.

## By alarm

| Alarm | Likely causes | Actions |
|---|---|---|
| SloBurnFast / SloBurnSlow (error budget burning 14.4× / 6× too fast, `SLO.md`) | Bad release, database down or saturated, dependency outage | Fast: act now, roll back if recent. Slow: investigate within the working day. Check `/health/ready` targets, database alarms, API error logs |
| AWS Budgets email (80% spent, or forecast over budget) | Traffic growth, a runaway task count, NAT or log volume | Cost Explorer by service and `shopmint:environment` tag; `COST_REVIEW.md` levers |
| Api/Web unhealthy task | Task crash-looping (config, secret missing, out of memory) | ECS → service → stopped tasks → reason; logs of the stopped task |
| API p95 > 800 ms | Slow queries, database CPU, too few tasks | Performance Insights top SQL; scale: `aws ecs update-service --desired-count`; check autoscaling max |
| Page p95 > 1 s | Web tasks saturated (≈70 pages/s per vCPU, Phase 11 measurement) | Raise web desired/max count; check the API latency too |
| API error logs > 20 / 5 min | Webhook failures, email delivery, unhandled exceptions | Logs Insights by `Category`; for email, check SES and the outbox backlog |
| Database CPU / memory / connections / storage | Load, a runaway query, pool sizes × tasks | Performance Insights (top SQL, waits, sessions); storage autoscaling max; pool sizes (`Database__MaxPoolSize` 40 per role per task) |
| CPU or memory > 85% | Under-provisioned or a leak | Scale out; compare with the last release |

## Suspend an abusive or fraudulent store

Platform console → Stores → the store → **Suspend** (needs a platform admin with two-step verification). The
storefront answers 503 within a minute, the admin becomes read-only, and paying can't lift it; only **Reactivate**
does. Record the reason and evidence in the incident ticket.

## A payment didn't confirm an order (replay a webhook)

ShopMint confirms payments from the Checkout callback and from webhooks; both are idempotent, and the order-expiry job
also reconciles with Razorpay. If a merchant reports a paid order still pending:

1. Find the order and its payment attempt (admin → Orders), and the payment in the merchant's Razorpay Dashboard.
2. In Razorpay Dashboard → Webhooks → the ShopMint webhook → find the event → **Resend**. Duplicates are ignored, so
   resending is safe. For ShopMint's own subscriptions, do the same in ShopMint's Razorpay account.
3. If the webhook is refused (logs show a signature error), the merchant's webhook secret doesn't match: they update it
   in Store settings → Payments and resend.

## After the incident

Write a short blameless review within 2 working days: timeline, impact (stores, orders, minutes), root cause, what
detected it, and follow-up tasks with owners. Update these runbooks where they were wrong or missing.
