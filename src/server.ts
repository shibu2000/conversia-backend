import { registerAIGateway } from "./ai/ai-gateway";
import { ConversiaAIGateway } from "./ai/gateway";
import { startIndexingWorker, stopIndexingWorker } from "./ai/indexing/worker";
import { aiConfigured } from "./ai/providers";
import { startEmailWorker, stopEmailWorker } from "./modules/email/worker";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { closePool, verifyConnection } from "./db";
import { ensureEmbeddingDimensions } from "./db/ensure-embedding-dimensions";

async function main(): Promise<void> {
  await verifyConnection();
  logger.info("Connected to Postgres", { database: env.PGDATABASE });

  /**
   * Turn on the AI layer, if it is configured.
   *
   * Registering the gateway is the single switch: every AI branch in the product
   * already calls through `aiGateway()` and checks `isEnabled()` first. With no
   * configuration this block does not run, and the product behaves exactly as it
   * did before the layer existed — documents stored but not indexed, retrieval
   * reporting it is unavailable, the widget falling back honestly.
   */
  if (aiConfigured()) {
    // Picks up a provider swap on restart without a hand-run migration — but
    // only while the table holds no real embeddings yet. See the module doc
    // for why an established deployment gets refused instead of resized.
    await ensureEmbeddingDimensions();
    registerAIGateway(new ConversiaAIGateway());
    startIndexingWorker();
    logger.info("AI layer enabled", {
      provider: env.AI_PROVIDER,
      embeddingModel: env.AI_EMBEDDING_MODEL,
      chatModel: env.AI_CHAT_MODEL,
    });
  } else {
    logger.info("AI layer not configured; knowledge indexing and generated answers are off.");
  }

  // Always on: it has nothing to do until a workspace configures a mail server,
  // and starting it conditionally would mean a restart after the first one does.
  startEmailWorker();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Conversia API listening on http://localhost:${env.PORT}${env.API_PREFIX}`, {
      env: env.NODE_ENV,
      corsOrigins: env.corsOrigins,
    });
  });

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then close the pool. The timeout is a backstop — a hung request
   * should not keep a rolling deploy waiting indefinitely.
   */
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down.`);
    stopIndexingWorker();
    stopEmailWorker();
    const timer = setTimeout(() => {
      logger.error("Shutdown timed out, exiting.");
      process.exit(1);
    }, 10_000);
    timer.unref();

    server.close(async () => {
      await closePool();
      logger.info("Shutdown complete.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: Error) => {
  logger.error(`Failed to start: ${error.message}`, { stack: error.stack });
  process.exit(1);
});
