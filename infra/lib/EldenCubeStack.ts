import * as path from 'path';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import type { Construct } from 'constructs';

export interface EldenCubeStackProps extends StackProps {
  /** Email address for the USD 5 budget alerts (ARCHITECTURE.md §9.1). */
  readonly alertEmail: string;
}

/** Static hosting for The Elden Cube: private S3 + CloudFront (OAC) + budget guardrail. ARCHITECTURE.md §9.2. */
export class EldenCubeStack extends Stack {
  constructor(scope: Construct, id: string, props: EldenCubeStackProps) {
    super(scope, id, props);

    const distDir = path.join(__dirname, '..', '..', 'app', 'dist');

    // Private bucket: only CloudFront can read it (via OAC).
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
    });

    // Hashed assets: immutable, uploaded first.
    const assets = new s3deploy.BucketDeployment(this, 'Assets', {
      sources: [s3deploy.Source.asset(distDir)],
      destinationBucket: bucket,
      exclude: ['*'],
      include: ['assets/*'],
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
    });

    // Everything else (index.html, favicon, ...): no-cache, invalidated on every deploy.
    const site = new s3deploy.BucketDeployment(this, 'Site', {
      sources: [s3deploy.Source.asset(distDir)],
      destinationBucket: bucket,
      exclude: ['assets/*'],
      cacheControl: [s3deploy.CacheControl.noCache()],
      prune: false,
      distribution,
      distributionPaths: ['/*'],
    });
    site.node.addDependency(assets);

    // Cost guardrail: USD 5/month, alerts at 80% actual and 100% forecasted.
    const subscribers = [{ subscriptionType: 'EMAIL', address: props.alertEmail }];
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'elden-cube-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 5, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers,
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers,
        },
      ],
    });

    new CfnOutput(this, 'GameUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
