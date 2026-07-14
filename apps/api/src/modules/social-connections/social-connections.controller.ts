import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { AppError, ErrorCode, type SocialProvider } from '@social-publisher/shared';
import { mvpProviderSchema } from '@social-publisher/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { PublicUser } from '../auth/session.util';

import { SocialConnectionsService } from './social-connections.service';

function parseProvider(raw: string): SocialProvider {
  const result = mvpProviderSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Provedor desconhecido: ${raw}`, 400);
  }
  return result.data;
}

@ApiTags('social-connections')
@Controller('social-connections')
@UseGuards(SessionAuthGuard)
export class SocialConnectionsController {
  constructor(
    private readonly service: SocialConnectionsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@CurrentUser() user: PublicUser) {
    const connections = await this.service.list(user.id);
    return {
      mode: this.service.mode,
      connections,
    };
  }

  @Get(':provider/authorize')
  async authorize(
    @CurrentUser() user: PublicUser,
    @Param('provider') providerParam: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const provider = parseProvider(providerParam);
    const url = await this.service.beginAuthorization(user.id, provider);
    reply.redirect(url, 302);
  }

  @Get(':provider/callback')
  async callback(
    @CurrentUser() user: PublicUser,
    @Param('provider') providerParam: string,
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() _request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const provider = parseProvider(providerParam);
    const appUrl = this.config.getOrThrow<string>('APP_URL');
    try {
      await this.service.handleCallback(user.id, provider, query);
      reply.redirect(`${appUrl}/connections?connected=${provider}`, 302);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNKNOWN_PROVIDER_ERROR';
      reply.redirect(`${appUrl}/connections?error=${encodeURIComponent(code)}&provider=${provider}`, 302);
    }
  }

  @Get(':id/capabilities')
  getCapabilities(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.service.getCapabilities(user.id, id);
  }

  @Post(':id/refresh')
  @HttpCode(200)
  refresh(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.service.refresh(user.id, id);
  }

  @Delete(':id')
  @HttpCode(200)
  async disconnect(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    await this.service.disconnect(user.id, id);
    return { success: true };
  }

  @Get(':id/facebook-pages')
  listFacebookPages(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.service.listProviderPages(user.id, id);
  }

  @Post(':id/facebook-pages/:pageId/connect')
  connectFacebookPage(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Param('pageId') pageId: string,
  ) {
    return this.service.connectPage(user.id, id, pageId);
  }
}

@ApiTags('social-connections')
@Controller('facebook-pages')
@UseGuards(SessionAuthGuard)
export class FacebookPagesController {
  constructor(private readonly service: SocialConnectionsService) {}

  @Delete(':id')
  @HttpCode(200)
  async disconnect(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    await this.service.disconnectPage(user.id, id);
    return { success: true };
  }
}
