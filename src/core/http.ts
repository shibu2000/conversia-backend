import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Response envelope.
 *
 * The frontend's `ApiResult<T>` is `{ data, requestId }`. Returning the request
 * id on every response — success and failure alike — is what makes a user's
 * "it broke" screenshot traceable to a log line.
 */
export function sendData<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data, requestId: res.locals.requestId ?? randomUUID() });
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
