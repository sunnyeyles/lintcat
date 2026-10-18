import { redact, redactValue, type StructuredLogger } from "@pr-review/logging";

/** Redacts every field of every event; `secrets` is read at log time, so it can grow. */
export function redactingLogger(
  logger: StructuredLogger,
  secrets: readonly (string | undefined)[],
): StructuredLogger {
  const redactText = (text: string) => redact(text, secrets);
  return {
    info: (event, fields = {}) => logger.info(event, redactValue(fields, redactText) as typeof fields),
    error: (event, fields = {}) => logger.error(event, redactValue(fields, redactText) as typeof fields),
  };
}
