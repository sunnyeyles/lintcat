/** The one HTTP call a delivery makes. Any non-2xx response is a failure. */
import { DeliveryError } from "./errors.js";

export interface Notification {
  id: string;
  endpoint: string;
  payload: unknown;
  /** ISO timestamp after which the notification is no longer worth sending. */
  expiresAt?: string;
  /** The subscriber asked not to be notified between 22:00 and 07:00. */
  quietHours?: boolean;
}

export async function postNotification(notification: Notification): Promise<void> {
  const response = await fetch(notification.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(notification.payload),
  });
  if (!response.ok) {
    throw new DeliveryError(
      `endpoint answered ${response.status} for notification ${notification.id}`,
    );
  }
}
