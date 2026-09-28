/** A notification past its expiry is dropped instead of delivered. */
import { isAfter, parseISO } from "date-fns";

import type { Notification } from "./transport.js";

export function isExpired(notification: Notification, now: Date): boolean {
  return notification.expiresAt !== undefined && isAfter(now, parseISO(notification.expiresAt));
}
