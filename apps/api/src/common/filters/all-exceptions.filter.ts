import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AppError, ErrorCode } from '@social-publisher/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Normalizes every thrown error into `{ error: { code, message, retryable? } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof AppError) {
      this.logger.warn(
        JSON.stringify({ code: exception.code, path: request.url, requestId: request.id }),
      );
      reply.status(exception.httpStatus).send({
        error: { code: exception.code, message: exception.message, retryable: exception.retryable },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      reply.status(status).send({
        error: {
          code: status === 429 ? ErrorCode.RATE_LIMITED : 'HTTP_ERROR',
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    reply.status(500).send({
      error: { code: ErrorCode.INTERNAL_ERROR, message: 'Erro inesperado. Tente novamente.' },
    });
  }
}
