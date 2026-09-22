import type { StructuredLogger } from "@pr-review/logging";

/** Replaces every occurrence of each secret, so an echoing error cannot leak one. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  return secrets.reduce<string>(
    (redacted, secret) =>
      secret && secret.length >= 4 ? redacted.split(secret).join("[redacted]") : redacted,
    text,
  );
}

function redactValue(value: unknown, secrets: readonly (string | undefined)[]): unknown {
  if (typeof value === "string") return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]),
    );
  }
  return value;
}

/** Redacts every field of every event; `secrets` is read at log time, so it can grow. */
export function redactingLogger(
  logger: StructuredLogger,
  secrets: readonly (string | undefined)[],
): StructuredLogger {
  return {
    info: (event, fields = {}) => logger.info(event, redactValue(fields, secrets) as typeof fields),
    error: (event, fields = {}) => logger.error(event, redactValue(fields, secrets) as typeof fields),
  };
}
