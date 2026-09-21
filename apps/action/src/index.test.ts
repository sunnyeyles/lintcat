/**
 * The composition root: input mapping, event loading, entrypoint guard.
 * GITHUB_ACTIONS is cleared before import, which evaluates the guard.
 */
import {
  baseSha,
  finalFindingsJson,
  headSha,
  makeGithub,
  makeModel,
  message,
  textBlock,
  validRemotePrompt,
} from "@pr-review/ai/agent-test-support";
import { createCapturingLogger } from "@pr-review/logging";
import type {
  FileContentsRequest,
  PullRequestReadClient,
  RepositoryHistoryClient,
  ReviewPublishClient,
  ReviewThread,
  WriteFileRequest,
} from "@pr-review/github";
import {
  FIX_COMMIT_MARKER,
  MEMORY_FILE_PATH,
  createDashboardPublisher,
  runReview,
  type ReviewRunSpec,
} from "@pr-review/reviewer";
import { reviewRecordSchema } from "@pr-review/schemas";
import { afterAll, describe, expect, it, vi } from "vitest";

const originalGithubActions = vi.hoisted(() => {
  const previous = process.env["GITHUB_ACTIONS"];
  delete process.env["GITHUB_ACTIONS"];
  return previous;
});

import {
  actionEnvironment,
  getInput,
  requireInput,
  runAction,
  runEntrypoint,
  type ActionEnvironment,
} from "#src/index";

afterAll(() => {
  if (originalGithubActions === undefined) {
    delete process.env["GITHUB_ACTIONS"];
  } else {
    process.env["GITHUB_ACTIONS"] = originalGithubActions;
  }
});

const validInputs = {
  "INPUT_API-KEY": "sk-test-key",
  INPUT_MODEL: "gpt-run-model",
  "INPUT_GITHUB-TOKEN": "ghs-test-token",
};

/** An HTTP failure shaped the way Octokit raises one. */
function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** A pull_request event the action will actually review. */
function pullRequestEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: "opened",
    repository: { name: "example-service", owner: { login: "octo-org" } },
    pull_request: {
      number: 42,
      base: { sha: baseSha },
      head: { sha: headSha, repo: { full_name: "octo-org/example-service" } },
    },
    ...overrides,
  });
}

interface Harness {
  environment: ActionEnvironment;
  entries: ReturnType<typeof createCapturingLogger>["entries"];
  modelConfigs: {
    provider: string;
    apiKey: string;
    baseUrl?: string | undefined;
    modelId: string;
  }[];
  tokenConfigs: { token: string }[];
  promptClientConfigs: { publicKey: string; secretKey: string; baseUrl: string }[];
  /** Prompt names fetched, in order, across every client built. */
  promptFetches: { name: string; label: string | undefined }[];
  tracingConfigs: {
    baseUrl: string;
    release?: string | undefined;
    recordIo?: boolean | undefined;
  }[];
  dashboardPosts: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }[];
  /** How many times spans were flushed across the run. */
  flushCount: () => number;
  readPaths: string[];
  /** Every repository file read, with the commit it was read at. */
  fileReads: { path: string; ref: string }[];
  /** How many times a review agent called the model. */
  modelCalls: () => number;
  /** The run the inputs assembled; the real review still runs on it. */
  specs: ReviewRunSpec[];
  /** Pull requests whose review threads were listed. */
  threadListings: number[];
  /** Every file written to a branch, in order. */
  writes: { branch: string; path: string; content: string }[];
  exitCodes: number[];
  /** The GitHub client the run was given, so writes can be asserted on. */
  client: ReturnType<typeof makeGithub>;
}

interface HarnessOptions {
  /** Absent means the Langfuse seams are wired but must never be reached. */
  prompts?: Record<string, string | Error> | undefined;
  /** Fails every model call, after tracing has already started. */
  modelError?: Error | undefined;
  /** The review threads a merged pull request carries. */
  reviewThreads?: readonly ReviewThread[] | undefined;
  /** What the dashboard answers; a 200 carrying a review id by default. */
  dashboardResponse?: (() => Promise<Response>) | undefined;
}

function harness(
  env: Record<string, string | undefined>,
  eventFile: string | Error = pullRequestEvent(),
  options: HarnessOptions = {},
): Harness {
  const { logger, entries } = createCapturingLogger();
  const modelConfigs: Harness["modelConfigs"] = [];
  const tokenConfigs: { token: string }[] = [];
  const promptClientConfigs: Harness["promptClientConfigs"] = [];
  const promptFetches: Harness["promptFetches"] = [];
  const tracingConfigs: Harness["tracingConfigs"] = [];
  const dashboardPosts: Harness["dashboardPosts"] = [];
  let flushCount = 0;
  let modelCalls = 0;
  const readPaths: string[] = [];
  const fileReads: Harness["fileReads"] = [];
  const threadListings: number[] = [];
  const writes: Harness["writes"] = [];
  const exitCodes: number[] = [];
  const specs: ReviewRunSpec[] = [];

  const client = {
    ...makeGithub(),
    getFileContents: vi.fn(async (request: FileContentsRequest) => {
      fileReads.push({ path: request.path, ref: request.ref });
      // The branch starts without a memory file, as a first run would.
      throw httpError(404);
    }),
    listReviewThreads: vi.fn(async (ref) => {
      threadListings.push(ref.pullRequestNumber);
      return [...(options.reviewThreads ?? [])];
    }),
    writeFileOnBranch: vi.fn(async (request: WriteFileRequest) => {
      writes.push({
        branch: request.branch,
        path: request.path,
        content: request.content,
      });
    }),
  } satisfies PullRequestReadClient &
    RepositoryHistoryClient &
    ReviewPublishClient;

  return {
    client,
    entries,
    threadListings,
    writes,
    modelConfigs,
    tokenConfigs,
    promptClientConfigs,
    promptFetches,
    tracingConfigs,
    dashboardPosts,
    flushCount: () => flushCount,
    readPaths,
    fileReads,
    modelCalls: () => modelCalls,
    specs,
    exitCodes,
    environment: {
      env,
      readEventFile: (path) => {
        readPaths.push(path);
        return eventFile instanceof Error
          ? Promise.reject(eventFile)
          : Promise.resolve(eventFile);
      },
      createLanguageModel: (config) => {
        modelConfigs.push({
          provider: config.provider,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          modelId: config.modelId,
        });
        const { model, doGenerate } = makeModel(
          [],
          config.provider,
          config.modelId,
        );
        doGenerate.mockImplementation(async () => {
          modelCalls += 1;
          if (options.modelError !== undefined) {
            throw options.modelError;
          }
          return message([textBlock(finalFindingsJson([]))], "end_turn");
        });
        return model;
      },
      createTokenClient: (config) => {
        tokenConfigs.push({ token: config.token });
        return client;
      },
      createPromptClient: (config) => {
        promptClientConfigs.push({
          publicKey: config.publicKey,
          secretKey: config.secretKey,
          baseUrl: config.baseUrl,
        });
        return {
          getTextPrompt: (name, fetchOptions) => {
            promptFetches.push({ name, label: fetchOptions?.label });
            const scripted = options.prompts?.[name];
            if (scripted === undefined) {
              return Promise.reject(new Error(`unexpected prompt fetch: ${name}`));
            }
            return scripted instanceof Error
              ? Promise.reject(scripted)
              : Promise.resolve(scripted);
          },
        };
      },
      createLangfuseRuntime: (config) => {
        tracingConfigs.push({
          baseUrl: config.baseUrl,
          release: config.release,
          recordIo: config.recordIo,
        });
        return {
          forceFlush: () => {
            flushCount += 1;
            return Promise.resolve();
          },
        };
      },
      // The real publisher over a fake fetch: the request itself is the contract.
      createDashboardPublisher: (config) =>
        createDashboardPublisher({
          ...config,
          fetch: async (url, init) => {
            dashboardPosts.push({
              url: String(url),
              headers: (init?.headers ?? {}) as Record<string, string>,
              body: JSON.parse(String(init?.body)) as unknown,
            });
            return options.dashboardResponse === undefined
              ? Response.json({ reviewId: 1 })
              : await options.dashboardResponse();
          },
        }),
      runReview: (spec) => {
        specs.push(spec);
        return runReview(spec);
      },
      logger,
      setExitCode: (code) => exitCodes.push(code),
    },
  };
}

/** The events one run logged, in order. */
function events(entries: Record<string, unknown>[]): unknown[] {
  return entries.map((entry) => entry["event"]);
}

/** Drains pending microtasks so the entrypoint's catch has run. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const reviewEnv = {
  ...validInputs,
  GITHUB_EVENT_PATH: "/tmp/event.json",
  GITHUB_EVENT_NAME: "pull_request",
};

describe("getInput", () => {
  it("uppercases the input name and preserves dashes", () => {
    expect(getInput({ "INPUT_MODEL-BASE-URL": "u" }, "model-base-url")).toBe("u");
  });

  it("replaces spaces with underscores", () => {
    expect(getInput({ INPUT_MY_INPUT: "value" }, "my input")).toBe("value");
  });

  it("uppercases a name that is already uppercase or mixed case", () => {
    expect(getInput({ INPUT_MODEL: "m" }, "Model")).toBe("m");
    expect(getInput({ INPUT_MODEL: "m" }, "MODEL")).toBe("m");
  });

  it("trims surrounding whitespace from the value", () => {
    expect(getInput({ INPUT_MODEL: "  claude-test-model \n" }, "model")).toBe(
      "claude-test-model",
    );
  });

  it("returns the empty string when the variable is absent", () => {
    expect(getInput({}, "model")).toBe("");
  });

  it("returns the empty string for a whitespace-only value", () => {
    expect(getInput({ INPUT_MODEL: "   " }, "model")).toBe("");
  });

  it("does not fall back to an unprefixed environment variable", () => {
    expect(getInput({ MODEL: "leaked" }, "model")).toBe("");
  });
});

describe("requireInput", () => {
  it("returns the trimmed value when the input is present", () => {
    expect(requireInput({ INPUT_MODEL: " m " }, "model")).toBe("m");
  });

  it.each(["model", "github-token"])(
    "throws naming the %s input when it is missing",
    (name) => {
      expect(() => requireInput({}, name)).toThrow(
        `Missing required action input: ${name}`,
      );
    },
  );

  it("treats a whitespace-only input as missing", () => {
    expect(() => requireInput({ INPUT_MODEL: "  " }, "model")).toThrow(
      "Missing required action input: model",
    );
  });
});

describe("runAction", () => {
  it("fails when GITHUB_EVENT_PATH is not set", async () => {
    const { environment, readPaths } = harness({ ...validInputs });
    await expect(runAction(environment)).rejects.toThrow(
      "GITHUB_EVENT_PATH is not set",
    );
    expect(readPaths).toEqual([]);
  });

  it("fails when GITHUB_EVENT_PATH is set to the empty string", async () => {
    const { environment } = harness({ ...validInputs, GITHUB_EVENT_PATH: "" });
    await expect(runAction(environment)).rejects.toThrow(
      "GITHUB_EVENT_PATH is not set",
    );
  });

  it("propagates the error when the event file cannot be read", async () => {
    const { environment } = harness(
      { ...validInputs, GITHUB_EVENT_PATH: "/gone/event.json" },
      Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      }),
    );
    await expect(runAction(environment)).rejects.toThrow("ENOENT");
  });

  it("fails when the event file is not valid JSON", async () => {
    const { environment } = harness(
      { ...validInputs, GITHUB_EVENT_PATH: "/tmp/event.json" },
      "{ not json",
    );
    await expect(runAction(environment)).rejects.toThrow(SyntaxError);
  });

  it("fails when the github-token input is missing", async () => {
    const env: Record<string, string | undefined> = { ...reviewEnv };
    delete env["INPUT_GITHUB-TOKEN"];
    const { environment } = harness(env);
    await expect(runAction(environment)).rejects.toThrow(
      "Missing required action input: github-token",
    );
  });

  it("fails when neither the API key input nor the provider's variable is set", async () => {
    const env: Record<string, string | undefined> = { ...reviewEnv };
    delete env["INPUT_API-KEY"];
    const { environment } = harness(env);
    await expect(runAction(environment)).rejects.toThrow(
      "Missing required action input: api-key (or the OPENAI_API_KEY environment variable)",
    );
  });

  it("falls back to the selected provider's own key variable", async () => {
    const env: Record<string, string | undefined> = { ...reviewEnv };
    delete env["INPUT_API-KEY"];
    const { environment, modelConfigs } = harness({
      ...env,
      "INPUT_MODEL-PROVIDER": "anthropic",
      ANTHROPIC_API_KEY: "sk-anthropic-key",
      OPENAI_API_KEY: "sk-openai-key",
    });

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(modelConfigs[0]).toMatchObject({
      provider: "anthropic",
      apiKey: "sk-anthropic-key",
    });
  });

  it("defaults the model id when the model input is empty", async () => {
    const env: Record<string, string | undefined> = { ...reviewEnv };
    delete env["INPUT_MODEL"];
    const { environment, entries } = harness(env);

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "review.model_selected",
        provider: "openai",
        model: "gpt-5.6-luna",
      }),
    );
  });

  it("builds the client for the selected provider and base URL", async () => {
    const { environment, modelConfigs } = harness({
      ...reviewEnv,
      "INPUT_MODEL-PROVIDER": "openai",
      "INPUT_API-KEY": "sk-openai-key",
      "INPUT_MODEL-BASE-URL": "https://gateway.example/v1",
      INPUT_MODEL: "gpt-test-model",
    });

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(modelConfigs).toEqual([
      {
        provider: "openai",
        apiKey: "sk-openai-key",
        baseUrl: "https://gateway.example/v1",
        modelId: "gpt-test-model",
      },
    ]);
  });

  it("fails on an unknown provider before building any client", async () => {
    const { environment, modelConfigs } = harness({
      ...reviewEnv,
      "INPUT_MODEL-PROVIDER": "wattson",
    });

    await expect(runAction(environment)).rejects.toThrow(
      /Unknown model provider: wattson/,
    );
    expect(modelConfigs).toEqual([]);
  });

  it("reads the event file, builds both clients, and reviews", async () => {
    const { environment, readPaths, modelConfigs, tokenConfigs, entries } =
      harness(reviewEnv);

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(readPaths).toEqual(["/tmp/event.json"]);
    expect(modelConfigs).toEqual([
      {
        provider: "openai",
        apiKey: "sk-test-key",
        baseUrl: undefined,
        modelId: "gpt-run-model",
      },
    ]);
    expect(tokenConfigs).toEqual([{ token: "ghs-test-token" }]);
    expect(events(entries)).toContain("review.started");
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "review.started", isFork: false }),
    );
  });

  it("records that the head branch came from a fork", async () => {
    const { environment, entries } = harness(
      reviewEnv,
      pullRequestEvent({
        pull_request: {
          number: 42,
          base: { sha: baseSha },
          head: {
            sha: headSha,
            repo: { full_name: "contributor/example-service" },
          },
        },
      }),
    );

    await runAction(environment);

    expect(entries).toContainEqual(
      expect.objectContaining({ event: "review.started", isFork: true }),
    );
  });

  it.each([
    ["push", "unsupported event: push"],
    ["", "unsupported event: "],
  ])("skips %o without reading configuration", async (eventName, reason) => {
    // An event nobody reviews must not fail on a repository that has no
    // agents configured, and has no base commit to read them from.
    const env: Record<string, string | undefined> = { ...reviewEnv };
    if (eventName === "") {
      delete env["GITHUB_EVENT_NAME"];
    } else {
      env["GITHUB_EVENT_NAME"] = eventName;
    }
    const { environment, entries, fileReads, tokenConfigs } = harness(env);

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(entries).toEqual([
      { level: "info", event: "review.skipped", reason },
    ]);
    expect(fileReads).toEqual([]);
    expect(tokenConfigs).toEqual([]);
  });

  it("skips an ignored action without reading configuration", async () => {
    const { environment, entries, fileReads } = harness(
      reviewEnv,
      pullRequestEvent({ action: "labeled" }),
    );

    await runAction(environment);

    expect(entries).toEqual([
      { level: "info", event: "review.skipped", reason: "action ignored: labeled" },
    ]);
    expect(fileReads).toEqual([]);
  });
});

/** A merged pull_request `closed` event: the one the action learns from. */
function mergedEvent(merged = true): string {
  return pullRequestEvent({
    action: "closed",
    pull_request: {
      number: 42,
      merged,
      base: { sha: baseSha },
      head: { sha: headSha, repo: { full_name: "octo-org/example-service" } },
    },
  });
}

/** A resolved thread carrying both markers our findings post. */
const postedThread: ReviewThread = {
  body: [
    "**Missing tenant check**",
    "",
    "<!-- pr-review-finding: src/sessions.ts|Missing tenant check -->",
    "<!-- pr-review-category: security -->",
  ].join("\n"),
  isResolved: false,
  isOutdated: false,
};

describe("review memory", () => {
  const memoryEnv = { ...reviewEnv, "INPUT_MEMORY-BRANCH": "pr-review-memory" };

  it("records the outcomes of a merged pull request", async () => {
    const { environment, threadListings, writes, modelConfigs, entries } =
      harness(memoryEnv, mergedEvent(), { reviewThreads: [postedThread] });

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(threadListings).toEqual([42]);
    expect(writes).toEqual([
      {
        branch: "pr-review-memory",
        path: MEMORY_FILE_PATH,
        content: expect.stringContaining('"ignored": 1'),
      },
    ]);
    // No model is needed to learn, so none is built.
    expect(modelConfigs).toEqual([]);
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "memory.updated", signals: 1 }),
    );
  });

  it("is a no-op skip on a merge when no branch is configured", async () => {
    const { environment, entries, threadListings, writes, tokenConfigs } =
      harness(reviewEnv, mergedEvent(), { reviewThreads: [postedThread] });

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(entries).toEqual([
      { level: "info", event: "review.skipped", reason: "memory-branch not set" },
    ]);
    expect(threadListings).toEqual([]);
    expect(writes).toEqual([]);
    expect(tokenConfigs).toEqual([]);
  });

  it("skips a pull request that was closed without merging", async () => {
    const { environment, entries, threadListings } = harness(
      memoryEnv,
      mergedEvent(false),
    );

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(entries).toEqual([
      {
        level: "info",
        event: "review.skipped",
        reason: "pull request closed without merging",
      },
    ]);
    expect(threadListings).toEqual([]);
  });

  it("gives the review a memory store that reads the branch", async () => {
    const { environment, specs, fileReads } = harness(memoryEnv);

    await runAction(environment);

    expect(specs[0]?.memory).toBeDefined();
    expect(fileReads).toContainEqual({
      path: MEMORY_FILE_PATH,
      ref: "pr-review-memory",
    });
  });

  it("gives the review no memory at all when no branch is configured", async () => {
    const { environment, specs } = harness(reviewEnv);

    await runAction(environment);

    expect(specs[0]?.memory).toBeUndefined();
  });
});

const remotePrompts = {
  general_system: validRemotePrompt("general", "REMOTE GENERAL"),
};

const langfuseInputs = {
  "INPUT_LANGFUSE-PUBLIC-KEY": "pk-test",
  "INPUT_LANGFUSE-SECRET-KEY": "sk-test",
};

describe("Langfuse wiring", () => {
  it("builds no prompt client and no tracing when neither key is set", async () => {
    const { environment, promptClientConfigs, tracingConfigs, flushCount, entries } =
      harness(reviewEnv);

    await runAction(environment);

    expect(promptClientConfigs).toEqual([]);
    expect(tracingConfigs).toEqual([]);
    expect(flushCount()).toBe(0);
    // The default path stays silent about a feature nobody asked for.
    expect(
      events(entries).filter(
        (event) => typeof event === "string" && event.startsWith("langfuse."),
      ),
    ).toEqual([]);
  });

  it("fetches prompts and starts tracing when both keys are set", async () => {
    const {
      environment,
      promptClientConfigs,
      promptFetches,
      tracingConfigs,
      flushCount,
      entries,
    } = harness(
      { ...reviewEnv, ...langfuseInputs, GITHUB_SHA: "abc123" },
      pullRequestEvent(),
      { prompts: remotePrompts },
    );

    await runAction(environment);

    expect(promptClientConfigs).toEqual([
      {
        publicKey: "pk-test",
        secretKey: "sk-test",
        baseUrl: "https://cloud.langfuse.com",
      },
    ]);
    expect(promptFetches.map((fetch) => fetch.name)).toEqual(["general_system"]);
    expect(promptFetches.every((fetch) => fetch.label === "production")).toBe(true);
    // Fetching is not accepting: the contract guard could still reject them all.
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "langfuse.prompts.loaded",
        loadedCount: 1,
        fallbackCount: 0,
      }),
    );
    expect(tracingConfigs).toEqual([
      { baseUrl: "https://cloud.langfuse.com", release: "abc123", recordIo: false },
    ]);
    expect(flushCount()).toBe(1);
  });

  it.each([
    ["true", true],
    ["false", false],
    ["yes", false],
  ])("reads langfuse-record-io %j as recordIo %s", async (value, expected) => {
    const { environment, tracingConfigs } = harness(
      { ...reviewEnv, ...langfuseInputs, "INPUT_LANGFUSE-RECORD-IO": value },
      pullRequestEvent(),
      { prompts: remotePrompts },
    );

    await runAction(environment);

    expect(tracingConfigs.map((config) => config.recordIo)).toEqual([expected]);
  });

  it("honours a custom host and prompt label", async () => {
    const { environment, promptClientConfigs, promptFetches } = harness(
      {
        ...reviewEnv,
        ...langfuseInputs,
        "INPUT_LANGFUSE-BASE-URL": "https://langfuse.internal",
        "INPUT_LANGFUSE-PROMPT-LABEL": "staging",
      },
      pullRequestEvent(),
      { prompts: remotePrompts },
    );

    await runAction(environment);

    expect(promptClientConfigs[0]?.baseUrl).toBe("https://langfuse.internal");
    expect(promptFetches.every((fetch) => fetch.label === "staging")).toBe(true);
  });

  it.each([
    ["INPUT_LANGFUSE-SECRET-KEY", "langfuse-secret-key"],
    ["INPUT_LANGFUSE-PUBLIC-KEY", "langfuse-public-key"],
  ])(
    "reports half-configured credentials and reviews anyway when %s is missing",
    async (variable, missingInput) => {
      const env: Record<string, string | undefined> = {
        ...reviewEnv,
        ...langfuseInputs,
      };
      delete env[variable];
      const { environment, promptClientConfigs, tracingConfigs, entries } =
        harness(env);

      await expect(runAction(environment)).resolves.toBeUndefined();

      expect(promptClientConfigs).toEqual([]);
      expect(tracingConfigs).toEqual([]);
      expect(entries).toContainEqual({
        level: "error",
        event: "langfuse.disabled_incomplete_credentials",
        missingInput,
      });
    },
  );

  it("never logs key material", async () => {
    const { environment, entries } = harness(
      { ...reviewEnv, ...langfuseInputs },
      pullRequestEvent(),
      { prompts: remotePrompts },
    );

    await runAction(environment);

    const logged = JSON.stringify(entries);
    expect(logged).not.toContain("pk-test");
    expect(logged).not.toContain("sk-test");
  });

  it("falls back to the in-code prompts when every fetch fails", async () => {
    const { environment, entries } = harness(
      { ...reviewEnv, ...langfuseInputs },
      pullRequestEvent(),
      {
        prompts: { general_system: new Error("langfuse unavailable") },
      },
    );

    await expect(runAction(environment)).resolves.toBeUndefined();

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "langfuse.prompts.loaded",
        loadedCount: 0,
        fallbackCount: 1,
      }),
    );
  });

  it("flushes spans even when the run fails after tracing started", async () => {
    const { environment, flushCount } = harness(
      { ...reviewEnv, ...langfuseInputs },
      pullRequestEvent(),
      { prompts: remotePrompts, modelError: new Error("model provider unavailable") },
    );

    await expect(runAction(environment)).rejects.toThrow();

    expect(flushCount()).toBe(1);
  });
});

const dashboardInputs = {
  "INPUT_DASHBOARD-URL": "https://dash.example.app",
  "INPUT_DASHBOARD-TOKEN": "ingest-secret",
};

describe("review dashboard wiring", () => {
  it("posts nothing when neither input is set", async () => {
    const { environment, dashboardPosts, entries } = harness(reviewEnv);

    await runAction(environment);

    expect(dashboardPosts).toEqual([]);
    expect(
      events(entries).filter(
        (event) => typeof event === "string" && event.startsWith("dashboard."),
      ),
    ).toEqual([]);
  });

  it("posts the record once, to the ingest endpoint, as the bearer token", async () => {
    const { environment, dashboardPosts, entries } = harness({
      ...reviewEnv,
      ...dashboardInputs,
    });

    await runAction(environment);

    expect(dashboardPosts).toHaveLength(1);
    expect(dashboardPosts[0]?.url).toBe("https://dash.example.app/api/ingest");
    expect(dashboardPosts[0]?.headers).toMatchObject({
      authorization: "Bearer ingest-secret",
      "content-type": "application/json",
    });
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "dashboard.published", reviewId: 1 }),
    );
  });

  it("sends a body the ingest schema accepts, with the run's spend", async () => {
    const { environment, dashboardPosts } = harness({
      ...reviewEnv,
      ...dashboardInputs,
    });

    await runAction(environment);

    const parsed = reviewRecordSchema.safeParse(dashboardPosts[0]?.body);
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data).toMatchObject({
      owner: "octo-org",
      repo: "example-service",
      prNumber: 42,
      headSha,
      summary: "0 findings",
      findings: [],
    });
    expect(
      (parsed.data?.inputTokens ?? 0) + (parsed.data?.outputTokens ?? 0),
    ).toBeGreaterThan(0);
  });

  it.each([
    ["INPUT_DASHBOARD-TOKEN", "dashboard-token"],
    ["INPUT_DASHBOARD-URL", "dashboard-url"],
  ])(
    "records nothing and logs incomplete config when %s is missing",
    async (variable, missingInput) => {
      const env: Record<string, string | undefined> = {
        ...reviewEnv,
        ...dashboardInputs,
      };
      delete env[variable];
      const { environment, dashboardPosts, entries } = harness(env);

      await expect(runAction(environment)).resolves.toBeUndefined();

      expect(dashboardPosts).toEqual([]);
      expect(entries).toContainEqual({
        level: "error",
        event: "dashboard.disabled_incomplete_config",
        missingInput,
      });
    },
  );

  it("never logs the ingest token", async () => {
    const { environment, entries } = harness({ ...reviewEnv, ...dashboardInputs });

    await runAction(environment);

    expect(JSON.stringify(entries)).not.toContain("ingest-secret");
  });

  it("fails neither the review nor the step when the post is rejected", async () => {
    const { environment, entries, exitCodes } = harness(
      { ...reviewEnv, ...dashboardInputs, GITHUB_ACTIONS: "true" },
      pullRequestEvent(),
      { dashboardResponse: () => Promise.resolve(new Response("nope", { status: 500 })) },
    );

    runEntrypoint(environment);
    await flush();

    expect(exitCodes).toEqual([]);
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "dashboard.publish_failed",
        status: 500,
        error: "nope",
      }),
    );
    expect(events(entries)).toContain("review.published");
  });

  it("posts nothing for an event nobody reviews", async () => {
    const { environment, dashboardPosts } = harness({
      ...reviewEnv,
      ...dashboardInputs,
      GITHUB_EVENT_NAME: "push",
    });

    await runAction(environment);

    expect(dashboardPosts).toEqual([]);
  });
});

describe("runEntrypoint", () => {
  it.each([undefined, "", "false", "TRUE", "1"])(
    "performs no work when GITHUB_ACTIONS is %o",
    async (marker) => {
      const env: Record<string, string | undefined> = { ...validInputs };
      if (marker !== undefined) {
        env["GITHUB_ACTIONS"] = marker;
      }
      const { environment, entries, readPaths, exitCodes } = harness(env);

      runEntrypoint(environment);
      await flush();

      expect(readPaths).toEqual([]);
      expect(entries).toEqual([]);
      expect(exitCodes).toEqual([]);
    },
  );

  it('runs the action when GITHUB_ACTIONS is exactly "true"', async () => {
    const { environment, readPaths, entries, exitCodes } = harness({
      ...reviewEnv,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
    });

    runEntrypoint(environment);
    await flush();

    expect(readPaths).toEqual(["/tmp/event.json"]);
    expect(events(entries)).toEqual(["review.skipped"]);
    expect(exitCodes).toEqual([]);
  });

  it("logs review.failed and sets a non-zero exit code when the run throws", async () => {
    const { environment, entries, exitCodes } = harness({
      ...validInputs,
      GITHUB_ACTIONS: "true",
    });

    runEntrypoint(environment);
    await flush();

    expect(exitCodes).toEqual([1]);
    expect(entries).toEqual([
      {
        level: "error",
        event: "review.failed",
        error: expect.stringContaining("GITHUB_EVENT_PATH is not set"),
        errorName: "Error",
      },
    ]);
  });

  it("stringifies a non-Error rejection in the review.failed log", async () => {
    const { environment, entries, exitCodes } = harness(
      { ...validInputs, GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: "/tmp/e.json" },
      "unused",
    );
    environment.readEventFile = () => Promise.reject("boom");

    runEntrypoint(environment);
    await flush();

    expect(exitCodes).toEqual([1]);
    expect(entries).toEqual([
      { level: "error", event: "review.failed", error: "boom", errorName: "Error" },
    ]);
  });

  it("does not run the action merely by importing the module", () => {
    // The import above already evaluated the guard with GITHUB_ACTIONS cleared.
    expect(process.exitCode).not.toBe(1);
  });
});

describe("actionEnvironment", () => {
  it("wires the real process environment and client factories", () => {
    const environment = actionEnvironment();
    expect(environment.env).toBe(process.env);
    expect(typeof environment.readEventFile).toBe("function");
    expect(typeof environment.createLanguageModel).toBe("function");
    expect(typeof environment.createTokenClient).toBe("function");
    expect(typeof environment.createPromptClient).toBe("function");
    expect(typeof environment.createLangfuseRuntime).toBe("function");
    expect(typeof environment.setExitCode).toBe("function");
    expect(typeof environment.logger.info).toBe("function");
    expect(typeof environment.logger.error).toBe("function");
  });
});

/** What each input becomes in the run the Action assembles. */
describe("the review policy", () => {
  const policy = (specs: ReviewRunSpec[]) => specs[0]?.policy;

  it("reads the whole pull request when the incremental input is absent", async () => {
    const { environment, specs } = harness({ ...reviewEnv });

    await runAction(environment);

    expect(policy(specs)?.incremental).toBe(false);
  });

  it.each(["false", "yes", "TRUE", "1"])(
    "reads the whole pull request for the incremental value %s",
    async (value) => {
      const { environment, specs } = harness({
        ...reviewEnv,
        INPUT_INCREMENTAL: value,
      });

      await runAction(environment);

      expect(policy(specs)?.incremental).toBe(false);
    },
  );

  it("narrows to the commits since the last review when the input is true", async () => {
    const { environment, specs } = harness({
      ...reviewEnv,
      INPUT_INCREMENTAL: "true",
    });

    await runAction(environment);

    expect(policy(specs)?.incremental).toBe(true);
  });

  it("builds the index when the index input is absent", async () => {
    const { environment, specs } = harness({ ...reviewEnv });

    await runAction(environment);

    expect(policy(specs)?.index).toBe(true);
  });

  it.each(["true", "yes", "1", ""])(
    "leaves the index on for the value %s",
    async (value) => {
      const { environment, specs } = harness({ ...reviewEnv, INPUT_INDEX: value });

      await runAction(environment);

      expect(policy(specs)?.index).toBe(true);
    },
  );

  it("switches the index off only for an explicit false", async () => {
    const { environment, specs } = harness({
      ...reviewEnv,
      INPUT_INDEX: "false",
    });

    await runAction(environment);

    expect(policy(specs)?.index).toBe(false);
  });
});

describe("the fix input", () => {
  /** Supplying a committer is the only way to ask for a fix commit. */
  function commitsFixes(specs: ReviewRunSpec[]): boolean {
    return specs[0]?.delivery.publishFixes !== undefined;
  }

  it("leaves fixes off when the input is absent", async () => {
    const { environment, specs, client } = harness({ ...reviewEnv });

    await runAction(environment);

    expect(commitsFixes(specs)).toBe(false);
    expect(client.getCommitMessage).not.toHaveBeenCalled();
  });

  it.each(["false", "yes", "TRUE", "1"])(
    "leaves fixes off for the value %s",
    async (value) => {
      const { environment, specs } = harness({ ...reviewEnv, INPUT_FIX: value });

      await runAction(environment);

      expect(commitsFixes(specs)).toBe(false);
    },
  );

  it("turns fixes on for an ordinary head commit", async () => {
    const { environment, specs, entries, client } = harness({
      ...reviewEnv,
      INPUT_FIX: "true",
    });

    await runAction(environment);

    expect(commitsFixes(specs)).toBe(true);
    expect(
      entries.find((entry) => entry["event"] === "review.started"),
    ).toMatchObject({ applyFixes: true });
    expect(client.getCommitMessage).toHaveBeenCalledWith({
      owner: "octo-org",
      repo: "example-service",
      sha: headSha,
    });
  });

  it("refuses to fix its own fix commit", async () => {
    const { environment, specs, entries, client } = harness({
      ...reviewEnv,
      INPUT_FIX: "true",
    });
    client.getCommitMessage.mockResolvedValue(
      `Apply 1 fix from the AI review\n\n${FIX_COMMIT_MARKER}`,
    );

    await runAction(environment);

    expect(commitsFixes(specs)).toBe(false);
    expect(
      entries.find((entry) => entry["event"] === "review.fixes.disabled"),
    ).toMatchObject({ reason: "the head commit is this action's own fix" });
  });

  it("leaves fixes off when the head commit cannot be read", async () => {
    const { environment, specs, client } = harness({
      ...reviewEnv,
      INPUT_FIX: "true",
    });
    client.getCommitMessage.mockRejectedValue(httpError(403));

    await runAction(environment);

    // Fail closed: an unreadable head commit could be one of ours.
    expect(commitsFixes(specs)).toBe(false);
  });
});
