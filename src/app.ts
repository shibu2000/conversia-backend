import path from "node:path";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler, requestId } from "./middleware/error-handler";
import { generalLimiter } from "./middleware/rate-limit";
import { requestLog } from "./middleware/request-log";
import { apiRouter } from "./routes";

export function createApp(): Express {
  const app = express();

  // Behind a load balancer, `req.ip` and `secure` are only correct when Express
  // is told to trust the proxy's forwarding headers. One hop — trusting the
  // whole chain would let a client spoof its own address to the rate limiter.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(requestId);
  // Before everything else, so a request refused by CORS or the rate limiter
  // is logged too — those are the ones that look like nothing happened.
  app.use(requestLog);

  /**
   * Security headers.
   *
   * This process serves JSON and uploaded files, never HTML, so the CSP is
   * maximally restrictive: nothing may be loaded or framed. `crossOriginResourcePolicy`
   * is relaxed to same-site because the frontend runs on a different port in
   * development and needs to fetch document downloads.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          sandbox: ["allow-downloads"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  /**
   * CORS for the dashboard API.
   *
   * An explicit allowlist, not a reflector. `credentials` is on because the
   * refresh cookie has to reach `/auth/refresh`, and a wildcard origin is
   * forbidden by the browser in that combination anyway — so a reflecting
   * implementation here would be both non-compliant and a vulnerability.
   */
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers (curl, server-side fetch) send no
        // Origin header at all; they are not subject to CORS.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        logger.warn("Blocked a cross-origin request", { origin });
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 86_400,
    }),
  );

  /**
   * CORS for the public widget endpoints.
   *
   * These are called from whatever website has embedded the widget, so a fixed
   * allowlist cannot work — the whole point is that any customer's domain can
   * reach them. Access control is per-tenant instead: `verifyOrigin` checks the
   * caller against that workspace's own allowed-domains list, and only
   * published content is ever served.
   *
   * `credentials` is deliberately off. These endpoints never read a cookie, and
   * leaving it on with a reflected origin is exactly the combination that turns
   * a public API into a session-riding one.
   */
  app.use(
    `${env.API_PREFIX}/widget`,
    cors({
      origin: true,
      credentials: false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  // A body cap is a denial-of-service control: without it a single request can
  // pin memory. File uploads bypass this and are capped separately by multer.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use(generalLimiter);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
