# Service Level Objectives

**Status: initial targets, not yet measured.** ShopMint hasn't served real traffic. These objectives come from the
non-functional requirements (`PRODUCT_REQUIREMENTS.md` §5) and are the starting point for alerting. After four weeks
of production traffic, the monthly operating review (`OPERATING_REVIEW.md`) compares them with what was measured and
sets the final values. Nothing here is a commitment to merchants until then.

## Objectives

| SLI (what is measured) | Source | Initial objective (30 days) | Alerting |
|---|---|---|---|
| **Availability**: share of requests through the load balancer that don't end in a 5xx (load balancer or target) | ALB `HTTPCode_ELB_5XX_Count`, `HTTPCode_Target_5XX_Count`, `RequestCount` | 99.9% (error budget 0.1%, about 43 minutes of full outage a month) | Burn-rate alarms, below |
| **API latency**: p95 target response time of `/api/*` | API target group `TargetResponseTime` | p95 < 300 ms for reads, < 800 ms for checkout | `ApiLatencyP95`: p95 > 800 ms for 10 minutes |
| **Page latency**: p95 target response time of pages | Web target group `TargetResponseTime` | p95 < 1 s (storefront LCP target 2.5 s at p75 is measured with Lighthouse) | `WebLatencyP95`: p95 > 1 s for 10 minutes |
| **Online payment success**: captured ÷ (captured + failed) payment attempts | Platform → Metrics (database) | ≥ 90% when there are at least 20 attempts | Shown on the metrics page; reviewed weekly (no automatic alarm yet) |
| **Email delivery**: messages waiting over 15 minutes, permanent failures | Platform → Metrics; API error logs | None waiting; failures investigated | Error-log alarm; metrics page |

## Burn-rate alerting (availability)

An error budget of 0.1% is spent evenly at a "burn rate" of 1. The alarms fire when it's spent much faster, and only
when both a long and a short window agree (so a blip doesn't page, and a recovered incident stops paging):

| Alarm | Burn rate | Long window | Short window | 5xx threshold | Budget used if it continues |
|---|---|---|---|---|---|
| `SloBurnFast` | 14.4× | 1 hour | 5 minutes | 1.44% | 2% of the month's budget per hour |
| `SloBurnSlow` | 6× | 6 hours | 30 minutes | 0.6% | 5% of the month's budget in 6 hours |

Defined in `infra/lib/core-stack.ts` (`SLO`), tested in `infra/test/infra.test.ts`. The dashboard `shopmint-<env>`
plots the hourly 5xx share against the budget.

## Error budget policy (proposed)

- Budget left: ship normally.
- Under 25% left in the 30-day window: releases are limited to fixes and reliability work until it recovers.
- Exhausted: a blameless review of what spent it, and its follow-ups take priority over features.

The product owner and engineering lead agree this policy at the first monthly review.
