import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { validationError } from "../core/errors";

/**
 * Validate and *replace* a request part with the parsed result.
 *
 * Replacing rather than merely checking is the point: handlers downstream read
 * `req.body` and get the stripped, coerced, correctly typed object, so an
 * unexpected extra field can never reach a database write. Zod errors are
 * reshaped into the `fieldErrors` map the frontend's forms render next to their
 * inputs.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body ?? {}) as z.infer<T>;
      next();
    } catch (error) {
      next(toApiError(error));
    }
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query ?? {}) as never;
      next();
    } catch (error) {
      next(toApiError(error));
    }
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params ?? {}) as never;
      next();
    } catch (error) {
      next(toApiError(error));
    }
  };
}

function toApiError(error: unknown): unknown {
  if (!(error instanceof ZodError)) return error;

  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    // Keep the first message per field; forms show one message per input.
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }

  const first = error.issues[0];
  return validationError(first ? first.message : "The submitted data is not valid.", fieldErrors);
}
