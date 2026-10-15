import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '@salesos/shared-types';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Accepts a well-formed inbound x-request-id, otherwise generates a UUID. Echoed on the response. */
export function requestIdMiddleware(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const id = typeof inbound === 'string' && SAFE_ID.test(inbound) ? inbound : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
