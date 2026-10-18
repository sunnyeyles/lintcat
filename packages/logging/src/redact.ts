/** Replaces every occurrence of each secret, so an echoing error cannot leak one. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  return secrets.reduce<string>(
    (redacted, secret) =>
      secret && secret.length >= 4 ? redacted.split(secret).join("[redacted]") : redacted,
    text,
  );
}

/** Applies `redactText` to every string inside a JSON-like value. */
export function redactValue(value: unknown, redactText: (text: string) => string): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactText));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, redactText)]),
    );
  }
  return value;
}
