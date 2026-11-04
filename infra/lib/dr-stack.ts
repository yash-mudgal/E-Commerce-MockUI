import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as backup from "aws-cdk-lib/aws-backup";
import { Construct } from "constructs";
import { EnvConfig } from "./config";

export interface DrStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * Backup vault in the second Indian region (Hyderabad). Copies of the database and media backups land here, so a
 * regional outage or a compromised primary account vault doesn't lose them, and data stays in India.
 */
export class DrStack extends Stack {
  readonly vaultArn: string;

  constructor(scope: Construct, id: string, props: DrStackProps) {
    super(scope, id, props);
    const vault = new backup.BackupVault(this, "Vault", {
      backupVaultName: `shopmint-${props.config.name}-dr`,
      removalPolicy: RemovalPolicy.RETAIN,
      // Nobody (including the account root) can delete recovery points early.
      lockConfiguration: { minRetention: Duration.days(7) },
    });
    this.vaultArn = vault.backupVaultArn;
  }
}
