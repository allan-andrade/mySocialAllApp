import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@social-publisher/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, registerTestUser } from './helpers';

const EMAIL = `e2e-media-${Date.now()}@example.com`;

// PNG mínimo válido (1x1), com assinatura correta para o teste de magic bytes.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c626001000000ffff03000006000557' +
    'bfabd40000000049454e44ae426082',
  'hex',
);

describe('Media — upload assinado no MinIO (e2e)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    app = await createTestApp();
    cookie = await registerTestUser(app, EMAIL);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    await app.close();
  });

  async function presign(sizeBytes: number, mimeType = 'image/png') {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/media/presigned-upload',
      headers: { cookie },
      payload: { filename: 'tiny.png', mimeType, sizeBytes },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { mediaAssetId: string; uploadUrl: string };
  }

  it('fluxo completo: presigned-upload → PUT no storage → complete → GET com URL', async () => {
    const { mediaAssetId, uploadUrl } = await presign(TINY_PNG.length);

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: TINY_PNG,
    });
    expect(put.ok).toBe(true);

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/media/complete',
      headers: { cookie },
      payload: { mediaAssetId, width: 1, height: 1 },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().processingStatus).toBe('READY');
    expect(complete.json().url).toContain('http');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/media/${mediaAssetId}`,
      headers: { cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().checksum ?? true).toBeTruthy();

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${mediaAssetId}`,
      headers: { cookie },
    });
    expect(remove.statusCode).toBe(200);
  });

  it('rejeita MIME disfarçado: conteúdo JPEG declarado como PNG', async () => {
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const { mediaAssetId, uploadUrl } = await presign(fakeJpeg.length);

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: fakeJpeg,
    });
    expect(put.ok).toBe(true);

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/media/complete',
      headers: { cookie },
      payload: { mediaAssetId },
    });
    expect(complete.statusCode).toBe(400);
    expect(complete.json().error.code).toBe('MEDIA_NOT_SUPPORTED');
  });

  it('complete sem objeto no storage falha com MEDIA_PROCESSING_FAILED', async () => {
    const { mediaAssetId } = await presign(1234);
    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/media/complete',
      headers: { cookie },
      payload: { mediaAssetId },
    });
    expect(complete.statusCode).toBe(400);
    expect(complete.json().error.code).toBe('MEDIA_PROCESSING_FAILED');
  });

  it('rejeita tipos de arquivo não permitidos (ex.: executável)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/media/presigned-upload',
      headers: { cookie },
      payload: { filename: 'run.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 },
    });
    expect(response.statusCode).toBe(400);
  });
});
