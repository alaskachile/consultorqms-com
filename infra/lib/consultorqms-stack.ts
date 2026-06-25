import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cognito from "aws-cdk-lib/aws-cognito";

export class ConsultorQmsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── Red ──────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 1 });

    // ── Aurora PostgreSQL Serverless v2 ──────────────────
    const db = new rds.DatabaseCluster(this, "Db", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      vpc,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      defaultDatabaseName: "consultorqms",
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    // ── S3 para evidencia y documentos ───────────────────
    const evidenceBucket = new s3.Bucket(this, "EvidenceBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"], // restringir al dominio de Vercel en producción
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // ── Cognito (auth) ───────────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 10, requireDigits: true, requireLowercase: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userPassword: true, userSrp: true },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // ── TODO (etapas siguientes) ─────────────────────────
    // - OpenSearch Serverless (vector store) + Bedrock Knowledge Base  → Etapa 4
    // - API Gateway HTTP API + Lambdas (Hono)                          → Etapa 2
    // - Step Functions / SQS para jobs largos                          → Etapa 6
    // - SES para notificaciones                                        → Etapa 7

    // ── Outputs ──────────────────────────────────────────
    new CfnOutput(this, "DbSecretArn", { value: db.secret?.secretArn ?? "n/a" });
    new CfnOutput(this, "EvidenceBucketName", { value: evidenceBucket.bucketName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
  }
}
