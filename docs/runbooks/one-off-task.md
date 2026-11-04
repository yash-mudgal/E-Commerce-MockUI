# Run an operator command as a one-off task

The database sits in isolated subnets with no bastion and no shell access to containers (ECS Exec is off). Operator
commands run as one-off Fargate tasks from the release's own image, with the same configuration and secrets as the
API service:

| Command | Effect |
|---|---|
| `verify-db` | Read-only health and safety check of the database (roles, migrations, row-level security, row counts). Exit 0 = pass |
| `reset-mfa <email>` | Clears someone's two-step verification and signs them out ([mfa-reset.md](mfa-reset.md)) |
| `platform-admin grant <email>` / `platform-admin revoke <email>` | Makes someone a platform admin or removes it; signs them out |
| `deploy-db` | Creates roles if missing and applies migrations (the release pipeline runs this; see the Migrate stack) |

```bash
CORE=ShopMint-$ENV-Core
out() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }
CLUSTER=$(out $CORE ClusterName); SUBNETS=$(out $CORE AppSubnets); SG=$(out $CORE ApiSecurityGroupId)

# Which task definition: verify-db (and deploy-db) need the owner password, which only the migration task has.
#   verify-db, deploy-db      → migration task, container "deploy-db", log group /shopmint/$ENV/migrate
#   reset-mfa, platform-admin → API task,       container "api",       log group /shopmint/$ENV/api
TASK_DEF=$(out ShopMint-$ENV-Migrate TaskDefinitionArn); CONTAINER=deploy-db; LOGS=migrate; CMD='["verify-db"]'
# TASK_DEF=$(aws ecs describe-services --cluster "$CLUSTER" --services api --query 'services[0].taskDefinition' --output text)
# CONTAINER=api; LOGS=api; CMD='["reset-mfa","person@example.com"]'

TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$TASK_DEF" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"$CONTAINER\",\"command\":$CMD}]}" \
  --started-by "operator-$(whoami)" --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode'
aws logs filter-log-events --log-group-name /shopmint/$ENV/$LOGS --log-stream-name-prefix "$CONTAINER/$CONTAINER/${TASK##*/}" \
  --query 'events[].message' --output text
```

The command's output is in the log group under the task's stream. Write the task ARN and the reason in the incident
or change log.
