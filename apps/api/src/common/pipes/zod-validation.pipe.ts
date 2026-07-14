import { Injectable, type PipeTransform } from '@nestjs/common';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join('; ');
      throw new AppError(ErrorCode.VALIDATION_ERROR, message, 400);
    }
    return result.data;
  }
}
