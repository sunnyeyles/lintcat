/** Delivers one notification, retrying inside the configured budget. */
import type { WorkerConfig } from "../config.js";
import { logger } from "../logging.js";
import { withRetryBudget } from "./retry.js";
import { postNotification, type Notification } from "./transport.js";

export async function sendNotification(
  notification: Notification,
  config: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  await withRetryBudget(config.retryBudgetMs, () => postNotification(notification));
  logger.info("delivery.sent", {
    id: notification.id,
    durationMs: Date.now() - startedAt,
  });
}
