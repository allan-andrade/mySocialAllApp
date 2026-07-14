import { Injectable } from '@nestjs/common';
import type { Draft, Prisma } from '@social-publisher/database';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { CreateDraftInput, UpdateDraftInput } from '@social-publisher/validation';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, input: CreateDraftInput): Promise<Draft> {
    return this.prisma.draft.create({
      data: {
        userId,
        text: input.text,
        selectedProviders: input.selectedProviders,
        providerOverrides: (input.providerOverrides ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  list(userId: string): Promise<Draft[]> {
    return this.prisma.draft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async get(userId: string, id: string): Promise<Draft> {
    const draft = await this.prisma.draft.findUnique({ where: { id } });
    if (!draft || draft.userId !== userId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Rascunho não encontrado.', 404);
    }
    return draft;
  }

  async update(userId: string, id: string, input: UpdateDraftInput): Promise<Draft> {
    await this.get(userId, id);
    return this.prisma.draft.update({
      where: { id },
      data: {
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.selectedProviders !== undefined
          ? { selectedProviders: input.selectedProviders }
          : {}),
        ...(input.providerOverrides !== undefined
          ? { providerOverrides: (input.providerOverrides ?? undefined) as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    await this.prisma.draft.delete({ where: { id } });
  }
}
