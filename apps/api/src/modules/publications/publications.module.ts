import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';

import {
  PublicationsController,
  PublicationTargetsController,
} from './publications.controller';
import { PublicationsService } from './publications.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [PublicationsController, PublicationTargetsController],
  providers: [PublicationsService],
  exports: [PublicationsService],
})
export class PublicationsModule {}
