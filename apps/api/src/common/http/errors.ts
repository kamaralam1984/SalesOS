import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine code. Rendered by AllExceptionsFilter. */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', msg, 403);
export const conflict = (code: string, msg: string) => new AppError(code, msg, 409);
export const unauthorized = (msg = 'Authentication required') => new AppError('UNAUTHENTICATED', msg, 401);
