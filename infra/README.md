# ShopMint infrastructure (AWS CDK, TypeScript)

One CDK app describes an environment (`-c env=staging` or `-c env=production`) in `ap-south-1` (Mumbai), with the
web ACL in `us-east-1` (a CloudFront requirement) and backup copies in `ap-south-2` (Hyderabad, so data stays in India).

| Stack | Region | Contents | Changes on a release? |
|---|---|---|---|
| `ShopMint-<env>-Foundation` | ap-south-1 | ECR repositories (immutable tags, scan on push), GitHub OIDC deploy role scoped to the GitHub environment | No (admin, once) |
| `ShopMint-<env>-Edge` | us-east-1 | AWS WAF web ACL: AWS managed rules, auth and global rate limits | Rarely |
| `ShopMint-<env>-Dr` | ap-south-2 | Locked backup vault for cross-region copies | Rarely |
| `ShopMint-<env>-Core` | ap-south-1 | VPC (public / app / isolated data subnets, NAT, S3 endpoint, flow logs), RDS PostgreSQL 16 (encrypted, TLS-only, PITR, Multi-AZ in production), role passwords and generated secrets, media bucket + CloudFront, ECS cluster, service discovery, load balancer (403 unless the CloudFront origin header is present), app CloudFront distribution with the edge function, AWS Backup plan, alarm topic, database and 5xx alarms | Rarely |
| `ShopMint-<env>-Migrate` | ap-south-1 | One-off `deploy-db` task definition for the release's image | Every release |
| `ShopMint-<env>-Services` | ap-south-1 | API and web Fargate services, target groups, listener rules, autoscaling, alarms, dashboard | Every release |

```bash
npm ci
npm test                # assertion tests on the synthesised templates (no AWS account needed)
npm run build && npx cdk synth -c env=staging -c account=… -c certificateArnGlobal=… -c certificateArnRegional=… \
  -c alarmEmail=… -c cloudFrontPrefixListId=… -c monthlyBudgetUsd=… [-c imageTag=<sha>]
```

Without `imageTag` only the long-lived stacks are synthesised. Releases are deployed by
`.github/workflows/deploy.yml`; the first deployment of an environment is a manual procedure in
`docs/runbooks/first-deploy.md`. Design notes: `docs/DEPLOYMENT_PLAN.md`, ADR-039 to ADR-042 and ADR-045 in `docs/DECISIONS.md`; SLOs in `docs/SLO.md`;
costs in `docs/COST_REVIEW.md`. Deploys also need `-c monthlyBudgetUsd=…` (AWS Budgets); `npm run cost` prints the
estimate it should come from (synthesises with placeholder values, makes no AWS calls).

Nothing here is secret: certificate ARNs, the account ID and the alarm email come from CDK context (the GitHub
environment's variables), and every secret value lives in AWS Secrets Manager.
