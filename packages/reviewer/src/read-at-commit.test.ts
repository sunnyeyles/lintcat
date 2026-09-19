import { baseSha, makeGithub } from "@pr-review/ai/agent-test-support";
import { describe, expect, it, vi } from "vitest";

import { readAtCommit } from "#src/read-at-commit";

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("readAtCommit", () => {
  const repository = { owner: "octo-org", repo: "example-service" };

  it("reads the requested path at the given commit", async () => {
    const client = { ...makeGithub(), getFileContents: vi.fn(async () => "agents:\n") };
    const read = readAtCommit(client, repository, baseSha);

    await expect(read(".github/pr-review-agents.yml")).resolves.toBe("agents:\n");
    expect(client.getFileContents).toHaveBeenCalledWith({
      owner: "octo-org",
      repo: "example-service",
      path: ".github/pr-review-agents.yml",
      ref: baseSha,
    });
  });

  it("resolves undefined for a file the commit does not have", async () => {
    const client = {
      ...makeGithub(),
      getFileContents: vi.fn(() => Promise.reject(httpError(404))),
    };

    await expect(
      readAtCommit(client, repository, baseSha)(".github/pr-review-agents.yml"),
    ).resolves.toBeUndefined();
  });

  it.each([403, 500])(
    "propagates a %s rather than reporting the file as absent",
    async (status) => {
      // A token without contents:read must not read as "no agents configured".
      const client = {
        ...makeGithub(),
        getFileContents: vi.fn(() => Promise.reject(httpError(status))),
      };

      await expect(
        readAtCommit(client, repository, baseSha)(".github/pr-review-agents.yml"),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );
});
