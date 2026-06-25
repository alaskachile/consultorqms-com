import { App } from "aws-cdk-lib";
import { ConsultorQmsStack } from "../lib/consultorqms-stack.js";

const app = new App();

new ConsultorQmsStack(app, "ConsultorQmsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
