/** The one HTTP call a delivery makes. Any non-2xx response is a failure. */
import { createHmac } from "node:crypto";

import { DeliveryError } from "./errors.js";

export interface Notification {
  id: string;
  endpoint: string;
  payload: unknown;
  /** ISO timestamp after which the notification is no longer worth sending. */
  expiresAt?: string;
}

export async function postNotification(
  notification: Notification,
  signingSecret: string,
): Promise<void> {
  const body = JSON.stringify(notification.payload);
  const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
  const response = await fetch(notification.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-notify-signature": signature },
    body,
  });
  if (!response.ok) {
    throw new DeliveryError(
      `endpoint answered ${response.status} for notification ${notification.id}`,
    );
  }
}
