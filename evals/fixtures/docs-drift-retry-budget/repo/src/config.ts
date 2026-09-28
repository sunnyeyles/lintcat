/**
 * Worker configuration, read once at boot. Every value comes from the
 * environment; nothing here reads a file or a command-line flag.
 */
import { ConfigError } from "./errors.js";

/** Environment variable holding the wall-clock budget one notification's retries get. */
export const RETRY_BUDGET_ENV = "NOTIFY_RETRY_BUDGET_MS";

/** The budget a notification gets when the environment names none. */
export const DEFAULT_RETRY_BUDGET_MS = 30_000;

/** The longest budget an operator may ask for. */
export const MAX_RETRY_BUDGET_MS = 300_000;

export interface WorkerConfig {
  queueUrl: string;
  /** Milliseconds a single notification may spend being retried. */
  retryBudgetMs: number;
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

  const raw = env[RETRY_BUDGET_ENV];
  const retryBudgetMs =
    raw === undefined || raw === ""
      ? DEFAULT_RETRY_BUDGET_MS
      : positiveInteger(raw, RETRY_BUDGET_ENV);
  if (retryBudgetMs > MAX_RETRY_BUDGET_MS) {
    throw new ConfigError(`${RETRY_BUDGET_ENV} must not exceed ${MAX_RETRY_BUDGET_MS}`);
  }

  return { queueUrl, retryBudgetMs };
}
