import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestCtx {
  requestId?: string;
  ip?: string;
}
const storage = new AsyncLocalStorage<RequestCtx>();

export const requestContext = {
  get: (): RequestCtx => storage.getStore() ?? {},
  run: <T>(ctx: RequestCtx, fn: () => T): T => storage.run(ctx, fn),
};

export function requestContextMiddleware(req: Request & { id?: string }, _res: Response, next: NextFunction) {
  storage.run({ requestId: req.id, ip: req.ip }, next);
}
