import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";
import { apiEnvironment, apiSecrets } from "./app-env";
import { EnvConfig } from "./config";
import { CoreStack } from "./core-stack";
import { repositoryNames } from "./foundation-stack";

export interface MigrateStackProps extends StackProps {
  config: EnvConfig;
  core: CoreStack;
  imageTag: string;
}

/**
 * The release's database step: a one-off Fargate task running `deploy-db` (create roles if missing, apply migrations)
 * with the new image. The deploy workflow deploys this stack, runs the task and waits for exit code 0 before it
 * touches the services. Migrations are expand/contract, so the running (old) code keeps working meanwhile.
 */
export class MigrateStack extends Stack {
  constructor(scope: Construct, id: string, props: MigrateStackProps) {
    super(scope, id, props);
    const { config, core } = props;
    const repo = ecr.Repository.fromRepositoryName(this, "ApiRepo", repositoryNames.api);
    const task = new ecs.FargateTaskDefinition(this, "DeployDb", {
      family: `shopmint-${config.name}-deploy-db`,
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    task.addContainer("deploy-db", {
      image: ecs.ContainerImage.fromEcrRepository(repo, props.imageTag),
      command: ["deploy-db"],
      environment: apiEnvironment(config, core),
      secrets: apiSecrets(core, { admin: true }),
      logging: ecs.LogDrivers.awsLogs({ logGroup: core.logGroups.migrate, streamPrefix: "deploy-db" }),
    });
    new CfnOutput(this, "TaskDefinitionArn", { value: task.taskDefinitionArn });
  }
}
