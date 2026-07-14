import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  completeUploadSchema,
  presignedUploadSchema,
  type CompleteUploadInput,
  type PresignedUploadInput,
} from '@social-publisher/validation';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { PublicUser } from '../auth/session.util';

import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
@UseGuards(SessionAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presigned-upload')
  createPresignedUpload(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(presignedUploadSchema)) body: PresignedUploadInput,
  ) {
    return this.media.createPresignedUpload(user.id, body);
  }

  @Post('complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(completeUploadSchema)) body: CompleteUploadInput,
  ) {
    return this.media.completeUpload(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.media.get(user.id, id);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    await this.media.remove(user.id, id);
    return { success: true };
  }
}
