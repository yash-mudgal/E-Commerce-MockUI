import * as ecs from "aws-cdk-lib/aws-ecs";
import { EnvConfig } from "./config";
import { CLIENT_IP_HEADER, CoreStack, INTERNAL_NAMESPACE } from "./core-stack";

/** API settings shared by the service and one-off tasks (deploy-db, reset-mfa). Secrets come from Secrets Manager. */
export function apiEnvironment(config: EnvConfig, core: CoreStack): Record<string, string> {
  return {
    ASPNETCORE_ENVIRONMENT: "Production",
    Database__Host: core.database.dbInstanceEndpointAddress,
    Database__Port: core.database.dbInstanceEndpointPort,
    Database__Name: "shopmint",
    Database__SslMode: "VerifyFull",
    Database__RootCertificate: "/app/certs/rds-global-bundle.pem",
    Database__MaxPoolSize: "40",
    App__PublicUrl: `https://${config.appDomain}`,
    Platform__StorefrontDomain: config.storefrontDomain,
    Platform__StorefrontUrlTemplate: "https://{host}",
    // Only the load balancer (public subnets) and web tasks (app subnets) reach the API; both are inside the VPC.
    Proxy__KnownNetworks__0: config.vpcCidr,
    Proxy__ClientIpHeader: CLIENT_IP_HEADER,
    Media__Bucket: core.mediaBucket.bucketName,
    Media__Region: config.region,
    Media__PublicBaseUrl: `https://${config.mediaDomain}`,
    Web__RevalidateUrl: `http://web.${INTERNAL_NAMESPACE}:3000/internal/revalidate`,
    Web__RevalidateFanOut: "true",
    Email__FromAddress: config.emailFrom,
    Email__Smtp__Host: config.smtpHost,
    Email__Smtp__Port: "587",
    Email__Smtp__Security: "StartTls",
    Payments__AllowTestMode: "false",
  };
}

export function apiSecrets(core: CoreStack, opts: { admin?: boolean } = {}): Record<string, ecs.Secret> {
  const s = ecs.Secret.fromSecretsManager;
  const secrets: Record<string, ecs.Secret> = {
    Database__Passwords__App: s(core.dbPasswords.app, "password"),
    Database__Passwords__Platform: s(core.dbPasswords.platform, "password"),
    Payments__SecretsKey: s(core.appSecret, "paymentsSecretsKey"),
    Billing__Razorpay__KeyId: s(core.appSecret, "billingRazorpayKeyId"),
    Billing__Razorpay__KeySecret: s(core.appSecret, "billingRazorpayKeySecret"),
    Billing__Razorpay__WebhookSecret: s(core.appSecret, "billingRazorpayWebhookSecret"),
    Email__Smtp__Username: s(core.appSecret, "smtpUsername"),
    Email__Smtp__Password: s(core.appSecret, "smtpPassword"),
    Web__RevalidateSecret: s(core.revalidateSecret),
  };
  if (opts.admin) {
    // deploy-db creates the roles and applies migrations: it needs the owner and master passwords too.
    secrets.Database__Passwords__Migrations = s(core.dbPasswords.owner, "password");
    secrets.Database__Passwords__Admin = s(core.database.secret!, "password");
    secrets.Database__AdminUsername = s(core.database.secret!, "username");
  }
  return secrets;
}
