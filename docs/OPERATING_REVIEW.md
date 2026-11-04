# Operating Review (post-launch loop)

How ShopMint learns from real use after launch: who looks at what, how often, and which decisions it feeds. The
inputs all exist in the product (Platform → Metrics, Platform → Feedback, the CloudWatch dashboard and alarms, AWS Cost
Explorer); the targets below are deliberately left open until real data exists.

## Weekly (30 minutes, engineering lead + product owner)

1. **Feedback triage** (Platform → Feedback, filter *New*): set each item to Triaged, Planned, Done or Declined with a
   team note. Reply by email when the sender asked to be contacted. Group recurring themes into roadmap items.
2. **Alarms and incidents** of the week: what fired, what was done, any runbook gaps.
3. **Metrics glance** (Platform → Metrics, last 4 weeks): sign-ups, launches, first orders, payment success and email
   health. Anything flagged amber or red gets an owner.

## Monthly (1 hour, + finance)

1. **Funnel**: conversion between onboarding stages for last month's sign-ups. Pick the weakest step and one change to
   try. Compare with the previous month.
2. **Revenue**: MRR, stores on paid plans, past-due MRR (at risk), trial conversion.
3. **Reliability**: error budget used against the SLOs (`SLO.md`); latency p95s; whether alarms were actionable.
4. **Cost**: spend against budget per service (`COST_REVIEW.md`).
5. Write a one-page summary (decisions and owners) in the team's drive.

## Quarterly

- Restore drill (`runbooks/restore.md`) and secret-rotation check (`runbooks/rotate-secrets.md`).
- Access review: platform admins (`platform-admin revoke` for leavers), GitHub environment reviewers, AWS users.
- Dependency and runtime updates (.NET, Node, PostgreSQL minor versions, CDK).
- Refresh the cost model and decide on savings plans once usage is stable.

## Targets to set from real metrics

The roadmap's Phase 13 exit criterion is "targets set from real metrics". These are the metrics and where they come
from; the target column is filled in at the first monthly review **after at least four weeks of production data**.

| Metric | Source | Guardrail until then | Target |
|---|---|---|---|
| Sign-up → launched within 14 days | Metrics → Onboarding | — | To set |
| Launched → first order within 30 days | Metrics → Onboarding | — | To set |
| Trial → paid plan | Metrics → Onboarding (*On a paid plan now*) | — | To set |
| MRR growth month on month | Metrics → Now | — | To set |
| Past-due MRR as share of MRR | Metrics → Now | Investigate above 5% | To set |
| Online payment success | Metrics → In this period | ≥ 90% with ≥ 20 attempts | To set |
| Availability / latency SLOs | CloudWatch, `SLO.md` | 99.9% / p95 300 ms reads | Confirm or revise |
| Feedback: median days New → Triaged | Platform → Feedback | ≤ 7 days | To set |
| Cost per paying store | Cost Explorer ÷ paying stores | Within budget | To set |
