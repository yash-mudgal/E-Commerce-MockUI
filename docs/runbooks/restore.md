# Restore the database

Targets: **RPO 15 minutes, RTO 4 hours** (PRODUCT_REQUIREMENTS.md §5). Backups:

| Backup | Where | Kept | Use |
|---|---|---|---|
| RDS continuous backup (point-in-time recovery, 5-minute granularity) | ap-south-1 | 35 days production, 7 staging | Undo a bad change or data loss: restore to just before it |
| AWS Backup daily snapshot (database and media bucket) | ap-south-1 vault | 35 days | Same, at daily granularity |
| Copy of each daily snapshot | ap-south-2 locked vault | 90 days production, 14 staging | Region outage, or the main account vault compromised |

A restore **always creates a new database instance**; the old one stays untouched until you delete it, so a wrong
choice of time can be redone.

## Point-in-time restore

1. Decide the restore time (UTC), e.g. one minute before the bad change (activity log, CloudTrail, deploy history).
   Announce the incident; if data is still being damaged, stop writes first (scale the API service to 0).
2. Restore to a new instance in the same subnet group and security group:
   ```bash
   SRC=$(aws cloudformation describe-stacks --stack-name ShopMint-$ENV-Core --query "Stacks[0].Outputs[?OutputKey=='DbInstanceId'].OutputValue" --output text)
   aws rds describe-db-instances --db-instance-identifier "$SRC" --query 'DBInstances[0].[DBSubnetGroup.DBSubnetGroupName,VpcSecurityGroups[0].VpcSecurityGroupId,DBParameterGroups[0].DBParameterGroupName]'
   aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$SRC" \
     --target-db-instance-identifier "shopmint-$ENV-restore-$(date +%Y%m%d%H%M)" --restore-time 2026-11-04T09:41:00Z \
     --db-subnet-group-name <subnet group> --vpc-security-group-ids <sg> --db-parameter-group-name <params> \
     --multi-az --no-publicly-accessible --copy-tags-to-snapshot
   aws rds wait db-instance-available --db-instance-identifier shopmint-$ENV-restore-…
   ```
3. **Verify it** with `verify-db` against the new endpoint: run the one-off task ([one-off-task.md](one-off-task.md))
   with an extra environment override `{"name":"Database__Host","value":"<new endpoint>"}`. Every line must be PASS;
   compare the row counts with what you expect. Spot-check the specific data that was damaged.
4. **Switch over:** for a full restore, point the environment at the new instance. The quickest path is to rename:
   stop writes (scale the API service to 0), rename the old instance to `…-old`, rename the restored one to the
   original identifier (the endpoint name follows the identifier), wait until available, scale the API back up, run
   the smoke test. Then bring CDK back in line (`cdk diff ShopMint-$ENV-Core` must show no database replacement).
   For a partial recovery (a few rows), copy the needed rows from the restored instance instead, and keep the live one.
5. Keep the old instance for 7 days, then take a final snapshot and delete it.

Sessions survive a restore: the session keys are in the database (`data_protection_keys`), so people stay signed in
(sessions changed after the restore point are lost, as is any data written after it).

## Restore from the other region (ap-south-2)

1. In ap-south-2, restore the latest recovery point from vault `shopmint-$ENV-dr` (AWS Backup console → Restore).
2. Deploy the stacks in ap-south-2 (set `region` in `infra/lib/config.ts` for the duration), pointing the database
   host at the restored instance, then switch DNS. Expect several hours; this is the disaster path.

## Restore drill (quarterly, and before launch)

On staging: restore to a point 1 hour ago, run `verify-db` on it, time each step, delete it. Record the date, the
time taken and the result in `docs/RELEASE_CHECKLIST.md` §4.

Locally, `ops/restore-drill-local.sh <container>` rehearses the logical path with Docker: back up roles and database,
restore into a brand-new PostgreSQL 16 server, run `verify-db` and compare row counts with the source.
