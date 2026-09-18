/** The GitHub-backed FileSource, over a structural fake of the client. */
import { describe, expect, it, vi } from "vitest";

import { createGithubFileSource } from "./github-source.js";

const repository = { owner: "octo-org", repo: "example-service" };

const sha = "6dcb09b5b57875f334f61aebed695e2e4193db5e";

/** An Octokit RequestError carries its status; httpStatus reads that field. */
function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function makeClient() {
  return {
    listTree: vi.fn(async () => ({
      paths: ["package.json", "src/sessions.ts"],
      truncated: false,
    })),
    getFileContents: vi.fn(async () => "export const sessions = [];\n"),
  };
}

describe("createGithubFileSource", () => {
  it("carries the sha it was built for", () => {
    expect(createGithubFileSource(makeClient(), repository, sha).sha).toBe(sha);
  });

  it("lists the tree at that sha", async () => {
    const client = makeClient();

    const listing = await createGithubFileSource(
      client,
      repository,
      sha,
    ).listPaths();

    expect(client.listTree).toHaveBeenCalledExactlyOnceWith({
      ...repository,
      ref: sha,
    });
    expect(listing).toEqual({
      paths: ["package.json", "src/sessions.ts"],
      truncated: false,
    });
  });

  it("passes a truncated listing through rather than hiding it", async () => {
    const client = makeClient();
    client.listTree.mockResolvedValueOnce({ paths: [], truncated: true });

    await expect(
      createGithubFileSource(client, repository, sha).listPaths(),
    ).resolves.toMatchObject({ truncated: true });
  });

  it("reads a file at that sha", async () => {
    const client = makeClient();

    const contents = await createGithubFileSource(
      client,
      repository,
      sha,
    ).read("src/sessions.ts");

    expect(client.getFileContents).toHaveBeenCalledExactlyOnceWith({
      ...repository,
      path: "src/sessions.ts",
      ref: sha,
    });
    expect(contents).toBe("export const sessions = [];\n");
  });

  it("returns undefined for a file that does not exist", async () => {
    const client = makeClient();
    client.getFileContents.mockRejectedValueOnce(httpError(404));

    await expect(
      createGithubFileSource(client, repository, sha).read("go.mod"),
    ).resolves.toBeUndefined();
  });

  it("rethrows any other failure", async () => {
    const client = makeClient();
    client.getFileContents.mockRejectedValueOnce(httpError(403));

    await expect(
      createGithubFileSource(client, repository, sha).read("src/sessions.ts"),
    ).rejects.toThrow("HTTP 403");
  });
});
