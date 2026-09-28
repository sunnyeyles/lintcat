/** The poll loop: one notification at a time, configuration read once at boot. */
import { loadConfig } from "./config.js";
import { sendNotification } from "./delivery/send.js";
import { logger } from "./logging.js";
import { receiveBatch } from "./queue.js";

export async function runWorker(env: Record<string, string | undefined>): Promise<void> {
  const config = loadConfig(env);
  logger.info("worker.started", { queueUrl: config.queueUrl });
  for (;;) {
    for (const notification of await receiveBatch(config.queueUrl)) {
      try {
        await sendNotification(notification, config);
      } catch (error) {
        logger.error("worker.dropped", { id: notification.id, error: String(error) });
      }
    }
  }
}
