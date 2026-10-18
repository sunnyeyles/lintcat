import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { redact } from "@pr-review/logging";

/** Credential formats masked in every exported span, wherever they appear: payloads, errors, diffs. */
export const SECRET_PATTERNS: readonly { name: string; pattern: RegExp; keep?: string }[] = [
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  // Anthropic (sk-ant-), OpenAI (sk-, sk-proj-) and Langfuse (sk-lf-) secret keys.
  { name: "sk- secret key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "bearer token", pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, keep: "$1" },
  { name: "authorization header", pattern: /(authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token)\s+)?)[^"'\s,}]+/gi, keep: "$1" },
];

export function maskSecretPatterns(text: string): string {
  return SECRET_PATTERNS.reduce(
    (masked, { pattern, keep = "" }) => masked.replace(pattern, `${keep}[redacted]`),
    text,
  );
}

/** Masks the registered secrets, then every `SECRET_PATTERNS` match. */
export function secretScrubber() {
  const lists = new Set<readonly (string | undefined)[]>();
  return {
    scrub: (text: string) => maskSecretPatterns(redact(text, [...lists].flat())),
    withSecrets(secrets: readonly (string | undefined)[]): () => void {
      lists.add(secrets);
      return () => {
        lists.delete(secrets);
      };
    },
  };
}

type AttributeMap = Record<string, unknown>;

function scrubAttributes(attributes: AttributeMap | undefined, scrub: (text: string) => string): void {
  if (!attributes) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string") attributes[key] = scrub(value);
    else if (Array.isArray(value)) {
      attributes[key] = value.map((item: unknown) => (typeof item === "string" ? scrub(item) : item));
    }
  }
}

// Rewrites the ended span in place before the exporter reads it, as Langfuse's own mask does.
export function scrubbingProcessor(inner: SpanProcessor, scrub: (text: string) => string): SpanProcessor {
  return {
    onStart: (...args: Parameters<SpanProcessor["onStart"]>) => inner.onStart(...args),
    onEnd(span: ReadableSpan) {
      const mutable = span as unknown as {
        attributes: AttributeMap;
        status: { message?: string };
        events: { attributes?: AttributeMap }[];
      };
      scrubAttributes(mutable.attributes, scrub);
      if (mutable.status.message) mutable.status = { ...mutable.status, message: scrub(mutable.status.message) };
      for (const event of mutable.events) scrubAttributes(event.attributes, scrub);
      inner.onEnd(span);
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
  };
}
