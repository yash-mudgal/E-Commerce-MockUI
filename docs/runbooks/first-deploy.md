# First deployment of an environment

Once per environment (staging first, then production). It takes about half a day, mostly waiting for certificates,
DNS and the database. Use separate AWS accounts for staging and production (AWS Organizations); the steps are the same.

## 1. Accounts and tools (administrator)

1. An AWS account per environment, with an administrator role for this procedure only (MFA required).
2. Bootstrap CDK in the three regions the app uses:
   ```bash
   npx cdk bootstrap aws://$ACCOUNT/ap-south-1 aws://$ACCOUNT/us-east-1 aws://$ACCOUNT/ap-south-2
   ```
3. Note the CloudFront origin-facing prefix list in ap-south-1:
   ```bash
   aws ec2 describe-managed-prefix-lists --region ap-south-1 \
     --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId'
   ```

## 2. Domain and certificates

Domains per environment are in `infra/lib/config.ts` (production: `shopmint.in`, `app.shopmint.in`,
`media.shopmint.in`, `origin.shopmint.in`; staging: the same under `staging.shopmint.in`).

1. ACM certificate in **us-east-1** for `*.<storefrontDomain>` (CloudFront): covers the app, media and every store.
2. ACM certificate in **ap-south-1** for `*.<storefrontDomain>` (the load balancer's `origin.` name).
3. Validate both with DNS records at the registrar or Route 53.

## 3. Email (Amazon SES, ap-south-1)

1. Verify the domain identity with DKIM, and set up a custom MAIL FROM domain, SPF and a DMARC record.
2. Request production access (leave the SES sandbox).
3. Create SMTP credentials (they are an IAM user's SMTP password; keep them only in the secret below).

## 4. The application secret (never in git, never in CDK)

```bash
aws secretsmanager create-secret --region ap-south-1 --name shopmint/$ENV/app --secret-string "$(jq -n \
  --arg k "$(openssl rand -base64 32)" \
  --arg rid "<ShopMint Razorpay key id>" --arg rs "<key secret>" --arg rw "<billing webhook secret>" \
  --arg su "<SES SMTP username>" --arg sp "<SES SMTP password>" \
  '{paymentsSecretsKey:$k, billingRazorpayKeyId:$rid, billingRazorpayKeySecret:$rs, billingRazorpayWebhookSecret:$rw, smtpUsername:$su, smtpPassword:$sp}')"
```

Type the values in a terminal without shell history (`HISTFILE=/dev/null`). **Back up `paymentsSecretsKey` offline**
(two people, sealed): losing it makes every merchant's stored Razorpay keys and everyone's two-step secrets
unreadable. Staging uses Razorpay **test** keys.

## 5. Foundation stack (ECR, GitHub deploy role)

```bash
cd infra && npm ci && npm run build
CTX="-c env=$ENV -c account=$ACCOUNT -c certificateArnGlobal=… -c certificateArnRegional=… -c alarmEmail=… -c cloudFrontPrefixListId=pl-…"
npx cdk deploy ShopMint-$ENV-Foundation $CTX     # add -c createGithubOidcProvider=false if the account already has it
```

Confirm the alarm email subscription from the inbox later (step 7 creates the topic).

## 6. GitHub

1. Settings → Environments → create `staging` and `production`. On `production`: required reviewers (two people),
   deployment branches/tags limited to `v*`.
2. Environment variables (not secrets; none of these is sensitive): `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN` (Foundation
   output), `CERT_ARN_GLOBAL`, `CERT_ARN_REGIONAL`, `ALARM_EMAIL`, `CLOUDFRONT_PREFIX_LIST_ID`, `APP_DOMAIN`,
   `MEDIA_DOMAIN`, `SMOKE_STORE_URL` (fill in after step 9).
3. Branch protection on `main`: pull requests with passing CI (`api`, `web`, `infra`, `secrets`, `e2e`).

## 7. Long-lived stacks and the first release (administrator, from a checkout of the release commit)

```bash
npx cdk deploy ShopMint-$ENV-Edge ShopMint-$ENV-Dr ShopMint-$ENV-Core $CTX
```

Then point DNS at the outputs: `app.` and `*.` → `AppCdnDomain`; `media.` → `MediaCdnDomain`; `origin.` →
`LoadBalancerDns` (CNAME or Route 53 alias records).

Set the repository variable `DEPLOY_ENABLED=true` and run **Actions → Deploy → Run workflow** for the environment.
It builds the images, runs `deploy-db` (which creates the database roles and schema) and starts the services.

**Not yet confirmed on RDS:** `deploy-db` creates `shopmint_platform` with `BYPASSRLS` as the RDS master user. It was
verified against PostgreSQL 16 with a non-superuser master that holds `CREATEROLE` and `BYPASSRLS` (the
"PostgreSQL 16 creator gets no SET option" problem was found and fixed that way), but whether RDS's master user may
grant `BYPASSRLS` must be confirmed on staging first (RELEASE_CHECKLIST.md §4). If `deploy-db` fails with "can't create
ShopMint's roles … BYPASSRLS", stop and raise it as a design change (for example RLS policies that admit the platform
role explicitly instead of `BYPASSRLS`); don't work around it by hand.

## 8. First platform admin

1. Sign up at `https://<appDomain>/signup` with the operator's own email (this creates a normal store too).
2. Run `platform-admin grant <email>` as a one-off task ([one-off-task.md](one-off-task.md)).
3. Sign in again and turn on two-step verification (Your account). The platform console opens only after that.
4. In Platform → Plans, paste each plan's Razorpay plan ID (DEPLOYMENT_PLAN.md → Billing).

## 9. Smoke test and checks

1. Create and launch a test store; set `SMOKE_STORE_URL` to it.
2. `node ops/smoke.cjs --app https://<appDomain> --store <SMOKE_STORE_URL> --edge` must pass, including the HTTPS
   redirect, `/internal/*` hidden and the `X-Forwarded-Host` check.
3. `curl -sk https://origin.<domain>/login` must answer **403** (the load balancer refuses traffic that didn't come
   through CloudFront).
4. Run `verify-db` ([one-off-task.md](one-off-task.md)).
5. Confirm the alarm email subscription; trigger a test alarm (`aws cloudwatch set-alarm-state … --state-value ALARM`).
6. Do the restore drill ([restore.md](restore.md)) before production carries real data.
