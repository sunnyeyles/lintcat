/** The poll loop: one notification at a time, configuration read once at boot. */
import { loadConfig } from "./config.js";
import { isExpired } from "./delivery/expiry.js";
import { inQuietHours } from "./delivery/quiet-hours.js";
import { sendNotification } from "./delivery/send.js";
import { logger } from "./logging.js";
import { receiveBatch } from "./queue.js";

export async function runWorker(env: Record<string, string | undefined>): Promise<void> {
  const config = loadConfig(env);
  logger.info("worker.started", { queueUrl: config.queueUrl });
  for (;;) {
    const now = new Date();
    for (const notification of await receiveBatch(config.queueUrl, now)) {
      if (isExpired(notification, now)) {
        logger.warn("worker.expired", { id: notification.id });
        continue;
      }
      if (inQuietHours(notification, now)) {
        logger.info("worker.deferred", { id: notification.id });
        continue;
      }
      try {
        await sendNotification(notification, config);
      } catch (error) {
        logger.error("worker.dropped", { id: notification.id, error: String(error) });
      }
    }
  }
}
