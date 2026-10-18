import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it } from "vitest";

import {
  maskSecretPatterns,
  scrubbingProcessor,
  SECRET_PATTERNS,
  secretScrubber,
} from "#src/scrub-spans";

const SAMPLES: Record<string, string> = {
  "private key":
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsecret\n-----END RSA PRIVATE KEY-----",
  "GitHub token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "GitHub fine-grained token": "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
  "sk- secret key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
  "AWS access key": "AKIAIOSFODNN7EXAMPLE",
  "bearer token": "Bearer eyJhbGciOiJIUzI1NiJ9.payload",
  "authorization header": 'authorization: "token-abcdef123456"',
};

describe("maskSecretPatterns", () => {
  it("has a sample for every pattern", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(SECRET_PATTERNS.map(({ name }) => name).sort());
  });

  it.each(Object.entries(SAMPLES))("masks a %s inside surrounding code", (_name, secret) => {
    const masked = maskSecretPatterns(`const value = ${secret};\n`);
    expect(masked).toContain("[redacted]");
    expect(masked).not.toContain(secret);
    expect(masked.startsWith("const value = ")).toBe(true);
  });

  it("keeps the scheme and header name, masking only the credential", () => {
    expect(maskSecretPatterns("Authorization: Bearer abcdef123456")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("leaves ordinary code alone", () => {
    const code = "const skip = task.ghost_id; // sk-short\nexport function bearer() {}";
    expect(maskSecretPatterns(code)).toBe(code);
  });
});

const JOB_SECRET = "job-installation-token-7c1e";
// SpanStatusCode.ERROR, without depending on @opentelemetry/api for one constant.
const STATUS_ERROR = 2;

let provider: NodeTracerProvider | undefined;
afterEach(async () => {
  await provider?.shutdown();
  provider = undefined;
});

function scrubbedExporter(scrub: (text: string) => string) {
  const exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [scrubbingProcessor(new SimpleSpanProcessor(exporter), scrub)],
  });
  return { exporter, tracer: provider.getTracer("test") };
}

describe("scrubbingProcessor", () => {
  it("masks a registered secret in attributes, status and exception events", () => {
    const scrubber = secretScrubber();
    scrubber.withSecrets([undefined, JOB_SECRET]);
    const { exporter, tracer } = scrubbedExporter(scrubber.scrub);

    const span = tracer.startSpan("review-job");
    span.setAttributes({
      "langfuse.observation.input": JSON.stringify({ diff: `token=${JOB_SECRET}` }),
      "langfuse.observation.output": JSON.stringify({ text: JOB_SECRET }),
      "gen_ai.tool.names": ["get_file", JOB_SECRET],
      "gen_ai.usage.input_tokens": 11,
    });
    span.recordException(new Error(`request failed with ${JOB_SECRET}`));
    span.setStatus({ code: STATUS_ERROR, message: `rejected ${JOB_SECRET}` });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    const text = JSON.stringify([exported?.attributes, exported?.status, exported?.events]);
    expect(text).not.toContain(JOB_SECRET);
    expect(exported?.status.message).toBe("rejected [redacted]");
    expect(exported?.attributes["gen_ai.usage.input_tokens"]).toBe(11);
  });

  it("stops masking a job's secrets once it removes them, and masks a list that grew", () => {
    const scrubber = secretScrubber();
    const secrets: string[] = [];
    const remove = scrubber.withSecrets(secrets);
    secrets.push(JOB_SECRET);
    expect(scrubber.scrub(JOB_SECRET)).toBe("[redacted]");

    remove();
    expect(scrubber.scrub(JOB_SECRET)).toBe(JOB_SECRET);
  });
});
