import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { OAuthStateService } from './oauth-state.service';
import {
  FacebookPagesController,
  SocialConnectionsController,
} from './social-connections.controller';
import { SocialConnectionsService } from './social-connections.service';

@Module({
  imports: [AuthModule],
  controllers: [SocialConnectionsController, FacebookPagesController],
  providers: [SocialConnectionsService, OAuthStateService],
  exports: [SocialConnectionsService],
})
export class SocialConnectionsModule {}
