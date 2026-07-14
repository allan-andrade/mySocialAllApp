import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createPublicationSchema,
  validatePublicationSchema,
  type CreatePublicationInput,
  type ValidatePublicationInput,
} from '@social-publisher/validation';
import type { FastifyReply } from 'fastify';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { PublicUser } from '../auth/session.util';

import { PublicationsService } from './publications.service';

@ApiTags('publications')
@Controller('publications')
@UseGuards(SessionAuthGuard)
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  @Post('validate')
  @HttpCode(200)
  validate(@Body(new ZodValidationPipe(validatePublicationSchema)) body: ValidatePublicationInput) {
    return this.publications.validate(body);
  }

  @Post()
  async create(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createPublicationSchema)) body: CreatePublicationInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { publication, reused } = await this.publications.create(user.id, body);
    // Requisição repetida (mesma chave de idempotência) devolve 200, não 201.
    reply.status(reused ? 200 : 201);
    return publication;
  }

  @Get()
  list(
    @CurrentUser() user: PublicUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('q') q?: string,
  ) {
    return this.publications.list(user.id, {
      cursor,
      limit: limit ? Number(limit) : undefined,
      status,
      provider,
      q,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.publications.get(user.id, id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.publications.retryPublication(user.id, id);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.publications.remove(user.id, id);
  }
}

@ApiTags('publications')
@Controller('publication-targets')
@UseGuards(SessionAuthGuard)
export class PublicationTargetsController {
  constructor(private readonly publications: PublicationsService) {}

  @Post(':id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.publications.retryTarget(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.publications.cancelTarget(user.id, id);
  }
}
