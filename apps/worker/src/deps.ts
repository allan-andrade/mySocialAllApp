import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createTokenCipherFromEnv } from '@social-publisher/crypto';
import { PrismaClient } from '@social-publisher/database';
import { createConnectorRegistry, type ConnectorMode } from '@social-publisher/social-connectors';

import type { ProcessorDeps } from './publication-processor';

export function buildProcessorDeps(env: NodeJS.ProcessEnv = process.env): ProcessorDeps {
  const prisma = new PrismaClient();
  const cipher = createTokenCipherFromEnv(env);
  const mode = (env['SOCIAL_CONNECTOR_MODE'] ?? 'mock') as ConnectorMode;
  const registry = createConnectorRegistry(mode);

  const bucket = env['S3_BUCKET'];
  const s3 = new S3Client({
    endpoint: env['S3_ENDPOINT'],
    region: env['S3_REGION'],
    credentials: {
      accessKeyId: env['S3_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: env['S3_SECRET_ACCESS_KEY'] ?? '',
    },
    forcePathStyle: true,
  });

  return {
    prisma,
    cipher,
    registry,
    presignMediaUrl: (storageKey: string) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: storageKey }), {
        // Tempo suficiente para o provedor baixar/processar a mídia (seção 13).
        expiresIn: 3600,
      }),
  };
}
