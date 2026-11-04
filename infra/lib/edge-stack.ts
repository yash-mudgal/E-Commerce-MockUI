import { Stack, StackProps } from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { EnvConfig } from "./config";

export interface EdgeStackProps extends StackProps {
  config: EnvConfig;
}

const visibility = (metricName: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
  cloudWatchMetricsEnabled: true,
  sampledRequestsEnabled: true,
  metricName,
});

const managed = (name: string, priority: number, excludedRules: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: {
    managedRuleGroupStatement: {
      vendorName: "AWS",
      name,
      ruleActionOverrides: excludedRules.map((rule) => ({ name: rule, actionToUse: { count: {} } })),
    },
  },
  visibilityConfig: visibility(name),
});

/** CloudFront's web ACL must live in us-east-1, so it gets its own stack (referenced across regions). */
export class EdgeStack extends Stack {
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const acl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `shopmint-${props.config.name}`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: visibility(`shopmint-${props.config.name}`),
      rules: [
        managed("AWSManagedRulesAmazonIpReputationList", 0),
        // Product descriptions and settings can exceed the 8 KB body rule; the API caps bodies at 1 MB itself.
        managed("AWSManagedRulesCommonRuleSet", 1, ["SizeRestrictions_BODY"]),
        managed("AWSManagedRulesKnownBadInputsRuleSet", 2),
        managed("AWSManagedRulesSQLiRuleSet", 3),
        {
          // Sign-in, sign-up, codes and resets: on top of the API's own per-IP limits.
          name: "AuthRateLimit",
          priority: 10,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 100,
              evaluationWindowSec: 300,
              aggregateKeyType: "IP",
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  searchString: "/api/auth/",
                  textTransformations: [{ priority: 0, type: "LOWERCASE" }],
                },
              },
            },
          },
          visibilityConfig: visibility("AuthRateLimit"),
        },
        {
          // Generous: shoppers on shared mobile carrier IPs browse many pages.
          name: "GlobalRateLimit",
          priority: 11,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 5000, evaluationWindowSec: 300, aggregateKeyType: "IP" } },
          visibilityConfig: visibility("GlobalRateLimit"),
        },
      ],
    });
    this.webAclArn = acl.attrArn;
  }
}
