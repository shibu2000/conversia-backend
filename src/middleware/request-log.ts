import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";

/**
 * One line per request, written when the response ends.
 *
 * The error handler already records failures in detail; this is the other half
 * — the requests that worked. Without it a dev watching the terminal cannot
 * tell a call that returned an empty list from one the frontend never made,
 * which is the question that comes up most often when a screen looks wrong.
 *
 * Bodies, headers and cookies are deliberately never logged: they carry
 * passwords on the auth routes and bearer tokens on every other one.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  let written = false;

  const write = (aborted: boolean) => {
    if (written) return;
    written = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const status = res.statusCode;
    const meta = {
      requestId: res.locals.requestId,
      userId: req.auth?.userId,
      companyId: req.companyId,
      bytes: res.get("content-length"),
    };
    const line = `${req.method} ${req.originalUrl} ${aborted ? "aborted" : status} ${durationMs.toFixed(1)}ms`;

    // The health check is polled; at `info` it would drown everything else.
    if (req.path === "/health") return logger.debug(line, meta);
    if (aborted) return logger.warn(line, meta);
    if (status >= 500) return logger.error(line, meta);
    if (status >= 400) return logger.warn(line, meta);
    logger.info(line, meta);
  };

  res.on("finish", () => write(false));
  // A client that navigates away mid-request never fires `finish`. Logging it
  // as aborted is what distinguishes "the server hung" from "the tab closed".
  res.on("close", () => write(!res.writableFinished));

  next();
}
