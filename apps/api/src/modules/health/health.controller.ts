import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

@Controller({ path: 'ready', version: VERSION_NEUTRAL })
export class ReadyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not-ready' });
    }
  }
}
