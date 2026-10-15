import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ApiEnvelope } from '@salesos/shared-types';
import { errorReporter } from '../observability/error-reporter';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

const isBodyParserError = (e: unknown): e is { status: number; type: string } =>
  !!e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number' && (e as { status: number }).status >= 400 && (e as { status: number }).status < 500 &&
  typeof (e as { type?: unknown }).type === 'string' && /^(entity\.|encoding\.|charset\.|request\.)/.test((e as { type: string }).type);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = STATUS_CODES[status] ?? 'ERROR';
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        if (typeof b.code === 'string') code = b.code;
        if (typeof b.message === 'string') message = b.message;
        else if (Array.isArray(b.message)) message = b.message.join('; ');
        details = b.details;
      }
      if (status === 429) {
        code = 'RATE_LIMITED';
        message = 'Too many requests, please slow down';
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'A record with these values already exists';
      } else if (exception.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Resource not found';
      } else {
        this.logger.error({ err: exception.code, requestId: req.id }, 'Prisma error');
      }
    } else if (isBodyParserError(exception)) {
      // body-parser / http-errors (malformed JSON, payload too large, unsupported charset): a client error, never a 500 and never echoes input
      status = exception.status;
      code = STATUS_CODES[status] ?? 'BAD_REQUEST';
      message = status === 413 ? 'Request body is too large' : status === 415 ? 'Unsupported media type or charset' : 'Malformed request body';
    } else {
      this.logger.error(
        { requestId: req.id, err: exception instanceof Error ? exception.stack : String(exception) },
        'Unhandled exception',
      );
    }

    if (status >= 500) {
      const route = (req as Request & { route?: { path?: string } }).route?.path;
      errorReporter().capture(exception, { requestId: req.id, route: route ? String(route) : undefined, method: req.method, status });
    }

    const body: ApiEnvelope<null> = {
      data: null,
      meta: { requestId: req.id },
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    };
    res.status(status).json(body);
  }
}
