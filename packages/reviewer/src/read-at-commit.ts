import type { ReadOptionalFile } from "@pr-review/ai";
import { httpStatus, type PullRequestReadClient } from "@pr-review/github";

/**
 * Reads repository files at one commit. The agent configuration is read at the
 * base commit, so the branch under review cannot choose its own reviewers.
 */
export function readAtCommit(
  client: PullRequestReadClient,
  repository: { owner: string; repo: string },
  ref: string,
): ReadOptionalFile {
  return async (filePath) => {
    try {
      return await client.getFileContents({ ...repository, path: filePath, ref });
    } catch (error: unknown) {
      // 404 is "not configured"; anything else, a missing contents:read
      // scope included, must not read as an absent file.
      if (httpStatus(error) === 404) {
        return undefined;
      }
      throw error;
    }
  };
}
