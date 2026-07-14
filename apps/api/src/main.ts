import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
  const port = Number(process.env['API_PORT'] ?? 4000);

  const adapter = new FastifyAdapter({
    trustProxy: true,
    logger: {
      level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCors, { origin: [appUrl], credentials: true });
  await app.register(fastifyCookie);

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('social-publisher API')
    .setDescription('API de publicação simultânea em múltiplas redes sociais')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '0.0.0.0');
  console.info(`API listening on http://localhost:${port} (docs at /api/docs)`);
}

void bootstrap();
