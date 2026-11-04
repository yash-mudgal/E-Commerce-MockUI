# Runbooks

Step-by-step procedures for operating ShopMint on AWS. Each one says when to use it, what it changes and how to check
the result. Commands assume the AWS CLI is signed in to the right account with an operator role, and
`ENV=staging` or `ENV=production`.

| Runbook | When |
|---|---|
| [first-deploy.md](first-deploy.md) | Setting up a new environment (once) |
| [deploy-and-rollback.md](deploy-and-rollback.md) | Releasing, and undoing a bad release |
| [one-off-task.md](one-off-task.md) | Running an operator command (`verify-db`, `reset-mfa`, `platform-admin`) |
| [restore.md](restore.md) | Restoring the database (point in time or from a snapshot); the quarterly restore drill |
| [rotate-secrets.md](rotate-secrets.md) | A secret leaked or is due for rotation |
| [incident-response.md](incident-response.md) | An alarm fired; suspending an abusive store; replaying a payment webhook |
| [mfa-reset.md](mfa-reset.md) | Someone lost their authenticator and recovery codes |
