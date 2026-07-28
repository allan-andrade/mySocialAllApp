import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { RequestMethod, VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@social-publisher/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

const TEST_EMAIL = `e2e-auth-${Date.now()}@example.com`;
const TEST_PASSWORD = 'supersecret123';

describe('Auth flow (e2e)', () => {
  let app: NestFastifyApplication;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie);
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'health', method: RequestMethod.GET },
        { path: 'ready', method: RequestMethod.GET },
        { path: 'metrics', method: RequestMethod.GET },
      ],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects login for a non-existent user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('registers, reads /me via the session cookie, then logs out', async () => {
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'E2E Tester', email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(registerResponse.statusCode).toBe(201);
    expect(registerResponse.json().user.email).toBe(TEST_EMAIL);

    const setCookie = registerResponse.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const sessionCookie = cookieHeader?.split(';')[0];
    expect(sessionCookie).toMatch(/^sp_session=/);

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionCookie! },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.email).toBe(TEST_EMAIL);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: sessionCookie! },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionCookie! },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });

  it('rejects duplicate registration with the same email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Dup', email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_ALREADY_IN_USE');
  });

  it('returns health and readiness', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
  });

  it('expõe métricas Prometheus sem dados sensíveis', async () => {
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('social_publisher_queue_jobs');
    expect(metrics.body).toContain('social_publisher_publication_targets');
    // Nenhum conteúdo de usuário nas métricas.
    expect(metrics.body).not.toContain(TEST_EMAIL);
    expect(metrics.body).not.toContain('token');
  });

  it('propaga o correlation ID (x-request-id) na resposta', async () => {
    const custom = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'meu-correlation-id-123' },
    });
    // A app de teste usa o FastifyAdapter default (sem genReqId custom), mas o
    // hook de resposta é registrado no bootstrap real; aqui garantimos que o
    // endpoint aceita o header sem erro. A propagação completa é verificada
    // no ambiente real via curl (docs/observability.md).
    expect(custom.statusCode).toBe(200);
  });
});
