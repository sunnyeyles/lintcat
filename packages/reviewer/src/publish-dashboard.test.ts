import { createCapturingLogger } from "@pr-review/logging";
import { reviewRecordSchema } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import {
  createDashboardPublisher,
  type DashboardReview,
} from "#src/publish-dashboard";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

const review: DashboardReview = {
  agents: ["security", "docs-drift"],
  summary: "1 finding from security, docs-drift",
  durationMs: 8_400,
  agentRuns: [
    {
      agent: "security",
      durationMs: 8_000,
      findingCount: 1,
      inputTokens: 1_200,
      cacheCreationInputTokens: 3_000,
      cacheReadInputTokens: 0,
      outputTokens: 340,
    },
    {
      agent: "docs-drift",
      durationMs: 5_000,
      findingCount: 0,
      inputTokens: 900,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 3_000,
      outputTokens: 120,
    },
  ],
  findings: [
    {
      file: "src/sessions.ts",
      line: 42,
      category: "security",
      severity: "high",
      title: "Assignment instead of comparison in admin check",
      explanation: "The if condition assigns instead of comparing.",
      confidence: 0.95,
      agent: "security",
    },
  ],
};

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function recordingFetch(respond: () => Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as unknown,
    });
    return respond();
  };
  return { fetch, calls };
}

const correlation = {
  repository: "octo-org/example-service",
  pullRequestNumber: 42,
  headSha: target.headSha,
};

describe("createDashboardPublisher", () => {
  it("posts the review record to <baseUrl>/api/ingest as the bearer token", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(Response.json({ reviewId: 7 }, { status: 200 })),
    );
    const { logger, entries } = createCapturingLogger();

    await createDashboardPublisher({
      baseUrl: "https://dash.example.app",
      token: "ingest-secret",
      fetch,
      logger,
    })(target, review);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://dash.example.app/api/ingest");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer ingest-secret",
      "content-type": "application/json",
    });
    expect(entries).toEqual([
      {
        level: "info",
        event: "dashboard.published",
        ...correlation,
        reviewId: 7,
      },
    ]);
  });

  it("sends a body the ingest schema accepts, per-agent usage included", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(Response.json({ reviewId: 7 })),
    );

    await createDashboardPublisher({
      baseUrl: "https://dash.example.app",
      token: "ingest-secret",
      fetch,
      logger: createCapturingLogger().logger,
    })(target, review);

    const parsed = reviewRecordSchema.safeParse(calls[0]?.body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      owner: "octo-org",
      repo: "example-service",
      prNumber: 42,
      headSha: target.headSha,
      ...review,
    });
  });

  it("appends the path to a base URL that ends in a slash", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(Response.json({ reviewId: 7 })),
    );

    await createDashboardPublisher({
      baseUrl: "https://dash.example.app/",
      token: "t",
      fetch,
      logger: createCapturingLogger().logger,
    })(target, review);

    expect(calls[0]?.url).toBe("https://dash.example.app/api/ingest");
  });

  it("logs a rejected POST and resolves anyway", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(new Response("unknown ingest token", { status: 401 })),
    );
    const { logger, entries } = createCapturingLogger();

    await expect(
      createDashboardPublisher({
        baseUrl: "https://dash.example.app",
        token: "wrong",
        fetch,
        logger,
      })(target, review),
    ).resolves.toBeUndefined();

    expect(entries).toEqual([
      {
        level: "error",
        event: "dashboard.publish_failed",
        ...correlation,
        status: 401,
        error: "unknown ingest token",
      },
    ]);
  });

  it("logs a network failure and resolves anyway", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.reject(new Error("ECONNREFUSED 127.0.0.1:443")),
    );
    const { logger, entries } = createCapturingLogger();

    await expect(
      createDashboardPublisher({
        baseUrl: "https://dash.example.app",
        token: "t",
        fetch,
        logger,
      })(target, review),
    ).resolves.toBeUndefined();

    expect(entries).toEqual([
      {
        level: "error",
        event: "dashboard.publish_failed",
        ...correlation,
        error: "ECONNREFUSED 127.0.0.1:443",
      },
    ]);
  });
});
