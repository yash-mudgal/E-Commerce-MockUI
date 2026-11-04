# Deploy and roll back

## Normal release

1. Merge the pull request to `main` (CI green). **Staging** deploys automatically (`.github/workflows/deploy.yml`):
   API image (once per commit) → Edge/Dr/Core stacks (usually no change) → web image for staging → `deploy-db`
   (migrations; the running version keeps serving) → services (rolling) → smoke test.
2. Check staging: the smoke test passed in the workflow, the dashboard `shopmint-staging` looks normal, and anything
   the change touched works.
3. Tag the commit: `git tag v1.4.0 <sha> && git push origin v1.4.0`. **Production** waits for a required reviewer to
   approve the `production` environment, then repeats the same steps with the **same API image**.
4. Watch the `shopmint-production` dashboard and alarms for 30 minutes.

Each ECS deployment keeps the old tasks until new ones pass the load balancer health check (`/health/ready` for the
API, which checks the database; `/internal/health` for web). If new tasks keep failing, the **deployment circuit
breaker rolls back automatically** and the workflow fails.

## Roll back

Migrations are expand/contract (additive first; removals only a release later), so the previous release works with
the current schema. A rollback is therefore **services only, never the database**.

1. Find the last good image tag: the commit SHA of the previous successful production run (Actions → Deploy).
2. Actions → Deploy → Run workflow → environment, `rollback_to = <sha>`. This skips building and `deploy-db`, deploys
   the Services stack with that tag (API `shopmint/api:<sha>`, web `shopmint/web:<sha>-<env>`) and runs the smoke test.
3. Revert the faulty change in git; it ships as a normal release.

If a migration itself was wrong (data damaged), don't roll forward blindly: stop writes if needed (suspend affected
stores, or scale the API service to 0 for a full stop), then follow [restore.md](restore.md).

## Long-lived stack changes

Changes to `infra/lib/core-stack.ts` (network, database, CDN) deploy with the next release. Review the CloudFormation
change set first for anything that **replaces** the database, buckets or VPC:

```bash
cd infra && npm run build && npx cdk diff ShopMint-$ENV-Core $CTX
```

The database, buckets and log groups are retained if their resources are ever removed, and the production Core stack
has termination protection.
