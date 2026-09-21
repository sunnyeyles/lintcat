/**
 * The seeding command's wiring, and that the text handed to Langfuse is
 * byte-for-byte what a review would have fallen back to.
 */

import {
  GENERAL_AGENT,
  inCodePrompts,
  type LangfusePromptWriter,
} from "@pr-review/ai";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it, vi } from "vitest";

import {
  MISSING_CREDENTIALS_MESSAGE,
  USAGE_EXIT_CODE,
  main,
  parseSeedArgs,
  requireLangfuseConfig,
} from "#src/seed-prompts-cli";

const CREDENTIALS = {
  LANGFUSE_PUBLIC_KEY: "pk-test",
  LANGFUSE_SECRET_KEY: "sk-test",
};

interface Harness {
  environment: Parameters<typeof main>[1] & {};
  published: { name: string; text: string; label: string }[];
  lines: string[];
}

/** A CLI environment whose Langfuse project is empty and offline. */
function harness(
  env: Record<string, string | undefined> = CREDENTIALS,
  writerOverrides: Partial<LangfusePromptWriter> = {},
): Harness {
  const published: { name: string; text: string; label: string }[] = [];
  const lines: string[] = [];
  return {
    published,
    lines,
    environment: {
      env,
      createWriter: vi.fn(() => ({
        readLabelled: vi.fn(async () => undefined),
        publish: vi.fn(async ({ name, text, label }) => {
          published.push({ name, text, label });
          return { text, version: 1 };
        }),
        ...writerOverrides,
      })),
      logger: createCapturingLogger().logger,
      write: (line: string) => lines.push(line),
    },
  };
}

describe("parseSeedArgs", () => {
  it("defaults to the production label, and a real run", () => {
    expect(parseSeedArgs([])).toEqual({
      label: "production",
      dryRun: false,
    });
  });

  it("accepts --label in both spellings", () => {
    expect(parseSeedArgs(["--label", "staging"]).label).toBe("staging");
    expect(parseSeedArgs(["--label=staging"]).label).toBe("staging");
  });

  it("accepts --dry-run alongside a label", () => {
    expect(parseSeedArgs(["--label", "staging", "--dry-run"])).toEqual({
      label: "staging",
      dryRun: true,
    });
  });

  it("ignores the separator pnpm forwards", () => {
    // pnpm leaves the `--` separator attached when it reaches the CLI.
    expect(parseSeedArgs(["--", "--dry-run"])).toEqual({
      label: "production",
      dryRun: true,
    });
  });

  it("rejects a flag with no value", () => {
    expect(() => parseSeedArgs(["--label"])).toThrow(/--label needs a value/);
    expect(() => parseSeedArgs(["--label", "--dry-run"])).toThrow(
      /--label needs a value/,
    );
  });

  it("rejects the `=` spelling with an empty value", () => {
    expect(() => parseSeedArgs(["--label="])).toThrow(/--label needs a value/);
  });

  it("rejects an unknown argument rather than ignoring it", () => {
    // A mistyped --dry-run must never fall through to a real publish.
    expect(() => parseSeedArgs(["--dryrun"])).toThrow(/Unknown argument/);
  });
});

describe("requireLangfuseConfig", () => {
  it("defaults the host but never the keys", () => {
    expect(requireLangfuseConfig(CREDENTIALS)).toEqual({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: "https://cloud.langfuse.com",
    });
  });

  it("honours a self-hosted or regional host", () => {
    expect(
      requireLangfuseConfig({
        ...CREDENTIALS,
        LANGFUSE_BASE_URL: "https://jp.cloud.langfuse.com",
      }).baseUrl,
    ).toBe("https://jp.cloud.langfuse.com");
  });

  it("throws when either key is missing", () => {
    expect(() => requireLangfuseConfig({})).toThrow(MISSING_CREDENTIALS_MESSAGE);
    expect(() =>
      requireLangfuseConfig({ LANGFUSE_PUBLIC_KEY: "pk-test" }),
    ).toThrow(MISSING_CREDENTIALS_MESSAGE);
  });
});

describe("main", () => {
  it("publishes the general prompt and succeeds", async () => {
    const { environment, published, lines } = harness();

    await expect(main([], environment)).resolves.toBe(0);

    expect(published.map((entry) => entry.name)).toEqual(["general_system"]);
    expect(lines.join("\n")).toContain("general");
  });

  it("publishes exactly the prompts a review would fall back to", async () => {
    const { environment, published } = harness();

    await main([], environment);

    const expected = inCodePrompts([GENERAL_AGENT]);
    expect(published.map((e) => e.text)).toEqual([expected["general"]]);
  });

  it("threads the label through to the publish", async () => {
    const { environment, published } = harness();

    await main(["--label", "staging"], environment);

    expect(published.every((entry) => entry.label === "staging")).toBe(true);
  });

  it("writes nothing on a dry run and still succeeds", async () => {
    const { environment, published, lines } = harness();

    await expect(main(["--dry-run"], environment)).resolves.toBe(0);

    expect(published).toEqual([]);
    expect(lines[0]).toContain("dry run");
    expect(lines.join("\n")).toContain("would be created");
  });

  it("reports missing credentials without building a client", async () => {
    const { environment, lines } = harness({});

    await expect(main([], environment)).resolves.toBe(USAGE_EXIT_CODE);

    expect(lines.join("\n")).toBe(MISSING_CREDENTIALS_MESSAGE);
    expect(environment.createWriter).not.toHaveBeenCalled();
  });

  it("reports a bad argument without building a client", async () => {
    const { environment, lines } = harness();

    await expect(main(["--nope"], environment)).resolves.toBe(USAGE_EXIT_CODE);

    expect(lines.join("\n")).toContain("Unknown argument: --nope");
    expect(environment.createWriter).not.toHaveBeenCalled();
  });

  it("exits non-zero when a prompt could not be published", async () => {
    const { environment } = harness(CREDENTIALS, {
      readLabelled: vi.fn(async (name: string) => {
        if (name === "general_system") {
          throw new Error("langfuse unavailable");
        }
        return undefined;
      }),
    });

    await expect(main([], environment)).resolves.toBe(1);
  });
});
