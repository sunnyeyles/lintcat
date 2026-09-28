/** Delivers one notification, retrying up to the configured number of attempts. */
import type { WorkerConfig } from "../config.js";
import { logger } from "../logging.js";
import { withAttempts } from "./retry.js";
import { postNotification, type Notification } from "./transport.js";

export async function sendNotification(
  notification: Notification,
  config: WorkerConfig,
): Promise<void> {
  const startedAt = Date.now();
  await withAttempts(config.maxAttempts, () => postNotification(notification, config.signingSecret));
  logger.info("delivery.sent", {
    id: notification.id,
    durationMs: Date.now() - startedAt,
  });
}
