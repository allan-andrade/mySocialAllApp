import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createDraftSchema,
  updateDraftSchema,
  type CreateDraftInput,
  type UpdateDraftInput,
} from '@social-publisher/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { PublicUser } from '../auth/session.util';

import { DraftsService } from './drafts.service';

@ApiTags('drafts')
@Controller('drafts')
@UseGuards(SessionAuthGuard)
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createDraftSchema)) body: CreateDraftInput,
  ) {
    return this.drafts.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.drafts.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.drafts.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDraftSchema)) body: UpdateDraftInput,
  ) {
    return this.drafts.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    await this.drafts.remove(user.id, id);
    return { success: true };
  }
}
