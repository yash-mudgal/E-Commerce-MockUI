import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { EnvConfig } from "./config";

export const repositoryNames = { api: "shopmint/api", web: "shopmint/web" } as const;

export interface FoundationStackProps extends StackProps {
  config: EnvConfig;
  /** Set false when another stack in this account already created the GitHub OIDC provider. */
  createGithubOidcProvider: boolean;
}

/**
 * Deployed once per environment by an administrator (docs/runbooks/first-deploy.md): the image repositories and the
 * role GitHub Actions assumes through OIDC. The role can only be used from the repository's matching GitHub
 * environment (which has required reviewers for production), so no AWS keys are stored in GitHub.
 */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const { config } = props;

    const repos = Object.values(repositoryNames).map(
      (name) =>
        new ecr.Repository(this, name.replace("/", "-"), {
          repositoryName: name,
          imageScanOnPush: true,
          imageTagMutability: ecr.TagMutability.IMMUTABLE,
          encryption: ecr.RepositoryEncryption.AES_256,
          removalPolicy: RemovalPolicy.RETAIN,
          lifecycleRules: [
            { description: "Drop untagged layers", tagStatus: ecr.TagStatus.UNTAGGED, maxImageAge: Duration.days(7) },
            { description: "Keep the last 100 releases (rollback window)", tagStatus: ecr.TagStatus.ANY, maxImageCount: 100 },
          ],
        }),
    );

    const providerArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;
    if (props.createGithubOidcProvider) {
      new iam.OpenIdConnectProvider(this, "GithubOidc", {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
      });
    }

    const deployRole = new iam.Role(this, "DeployRole", {
      roleName: `shopmint-${config.name}-deploy`,
      description: `GitHub Actions deploys to ${config.name} (environment-scoped OIDC trust)`,
      maxSessionDuration: Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${config.githubRepo}:environment:${config.name}`,
        },
      }),
    });
    // CDK deployments go through the roles created by `cdk bootstrap`, which hold the actual permissions.
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sts:AssumeRole"],
      resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
    }));
    for (const repo of repos) repo.grantPullPush(deployRole);
    deployRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    // Run the one-off migration task and wait for it; read its logs on failure.
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:RunTask"],
      resources: [`arn:aws:ecs:${this.region}:${this.account}:task-definition/*`],
      conditions: { StringEquals: { "aws:ResourceTag/shopmint:environment": config.name } },
    }));
    // Read-only calls without resource-level permissions (or with task ARNs not known in advance).
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:DescribeTasks", "ecs:DescribeTaskDefinition", "ecs:DescribeServices"],
      resources: ["*"],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [`arn:aws:iam::${this.account}:role/ShopMint-${config.name}-*`],
      conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["logs:GetLogEvents", "logs:FilterLogEvents"],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/shopmint/${config.name}/*`],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["cloudformation:DescribeStacks"],
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/ShopMint-${config.name}-*/*`],
    }));

    new CfnOutput(this, "DeployRoleArn", { value: deployRole.roleArn, description: "Set as AWS_DEPLOY_ROLE_ARN in the GitHub environment" });
  }
}
