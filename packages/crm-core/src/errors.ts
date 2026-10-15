/** Domain error raised by crm-core; the API maps it to AppError (same code/status), the worker logs it. */
export class CrmError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}
export const crmNotFound = (what = 'Resource') => new CrmError('NOT_FOUND', `${what} not found`, 404);
