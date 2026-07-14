import { Module } from '@nestjs/common';

import { HealthController, ReadyController } from './health.controller';

@Module({
  controllers: [HealthController, ReadyController],
})
export class HealthModule {}
