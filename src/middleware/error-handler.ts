import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { ApiError } from "../core/errors";

/** Attach a request id early, so logs and responses reference the same value. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { status: 404, code: "not_found", message: `No route matches ${req.method} ${req.path}.` },
    requestId: res.locals.requestId,
  });
}

/**
 * The single place an error becomes a response.
 *
 * Known `ApiError`s carry their own status and a message written for the person
 * reading it. Anything else is a bug: it is logged in full with the request id,
 * and the client is told only that something went wrong. Leaking a stack trace
 * or a driver message to the browser tells an attacker about the schema and
 * tells the user nothing they can act on.
 */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const id = res.locals.requestId ?? randomUUID();

  if (error instanceof ApiError) {
    if (error.status >= 500) {
      logger.error(error.message, { requestId: id, code: error.code, path: req.path });
    } else {
      logger.debug(error.message, { requestId: id, code: error.code, path: req.path });
    }

    res.status(error.status).json({
      error: {
        status: error.status,
        code: error.code,
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      },
      requestId: id,
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: { status: 422, code: "validation", message: "The submitted data is not valid." },
      requestId: id,
    });
    return;
  }

  // Postgres surfaces constraint violations as errors with a `code`. Translate
  // the ones a user can actually cause into something readable.
  const pgCode = (error as { code?: string }).code;
  if (pgCode === "23505") {
    res.status(409).json({
      error: { status: 409, code: "conflict", message: "That record already exists." },
      requestId: id,
    });
    return;
  }
  if (pgCode === "23503") {
    res.status(422).json({
      error: {
        status: 422,
        code: "invalid_reference",
        message: "A referenced record does not exist, or belongs to another workspace.",
      },
      requestId: id,
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error(`Unhandled error: ${message}`, { requestId: id, path: req.path, method: req.method, stack });

  res.status(500).json({
    error: {
      status: 500,
      code: "internal_error",
      message: "Something went wrong on our side. The request id below will help us find it.",
      // Only in development: in production this is exactly the detail that
      // helps an attacker and not the user.
      ...(env.isProduction ? {} : { debug: message }),
    },
    requestId: id,
  });
}
