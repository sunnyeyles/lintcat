/** Subscribers can ask not to be notified overnight; those notifications wait for morning. */
import dayjs from "dayjs";

import type { Notification } from "./transport.js";

export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7;

export function inQuietHours(notification: Notification, now: Date): boolean {
  if (notification.quietHours !== true) {
    return false;
  }
  const hour = dayjs(now).hour();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}
