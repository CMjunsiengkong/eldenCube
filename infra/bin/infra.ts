#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EldenCubeStack } from '../lib/EldenCubeStack';

const app = new cdk.App();

// alertEmail comes from cdk.json "context"; `-c alertEmail=...` on the command line overrides it.
const alertEmail: unknown = app.node.tryGetContext('alertEmail');
if (typeof alertEmail !== 'string' || alertEmail.trim() === '') {
  throw new Error('Pass -c alertEmail=you@example.com');
}

new EldenCubeStack(app, 'EldenCubeStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-southeast-1' },
  alertEmail: alertEmail.trim(),
});
