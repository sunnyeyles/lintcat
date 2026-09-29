/**
 * Worker configuration, read once at boot. Every value comes from the
 * environment; nothing here reads a file or a command-line flag.
 */
import { ConfigError } from "./errors.js";

/** Environment variable holding the number of delivery attempts one notification gets. */
export const MAX_ATTEMPTS_ENV = "NOTIFY_MAX_RETRIES";

/** The attempts a notification gets when the environment names none. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** The most attempts an operator may ask for. */
export const MAX_ATTEMPTS_CEILING = 20;

export interface WorkerConfig {
  queueUrl: string;
  /** Delivery attempts a single notification may use. */
  maxAttempts: number;
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive whole number`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): WorkerConfig {
  const queueUrl = env.NOTIFY_QUEUE_URL;
  if (queueUrl === undefined || queueUrl === "") {
    throw new ConfigError("NOTIFY_QUEUE_URL must be set");
  }

  const raw = env[MAX_ATTEMPTS_ENV];
  const maxAttempts =
    raw === undefined || raw === ""
      ? DEFAULT_MAX_ATTEMPTS
      : positiveInteger(raw, MAX_ATTEMPTS_ENV);
  if (maxAttempts > MAX_ATTEMPTS_CEILING) {
    throw new ConfigError(`${MAX_ATTEMPTS_ENV} must not exceed ${MAX_ATTEMPTS_CEILING}`);
  }

  return { queueUrl, maxAttempts };
}
