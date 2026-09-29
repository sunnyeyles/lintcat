import { describe, expect, it } from "vitest";

import { blobUrl } from "@/lib/github-links";

describe("blobUrl", () => {
  it("links one line of a file at a commit, escaping each path segment", () => {
    expect(blobUrl({ owner: "acme", repo: "api", sha: "abc123" }, "docs/access control.md", 20)).toBe(
      "https://github.com/acme/api/blob/abc123/docs/access%20control.md#L20",
    );
  });
});
