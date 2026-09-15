import { env } from "./env";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = ORDER[env.LOG_LEVEL];

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = { at: new Date().toISOString(), level, message, ...meta };
  const target = level === "error" || level === "warn" ? console.error : console.log;

  if (env.isProduction) {
    target(JSON.stringify(line));
    return;
  }

  // A terminal only ever shows today, so the date is nine characters of noise
  // on every line. The full timestamp stays in the production JSON.
  const time = line.at.slice(11, 23);
  target(`${time} ${level.toUpperCase().padEnd(5)} ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};
