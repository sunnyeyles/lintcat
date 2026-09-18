/**
 * A FileSource over one repository at a fixed commit, read through the
 * GitHub API. Nothing is cloned; every read is one request.
 */
import { httpStatus, type GithubInstallationClient } from "@pr-review/github";

import type { FileSource } from "./types.js";

export function createGithubFileSource(
  client: Pick<GithubInstallationClient, "listTree" | "getFileContents">,
  repository: { owner: string; repo: string },
  sha: string,
): FileSource {
  return {
    sha,

    listPaths() {
      return client.listTree({ ...repository, ref: sha });
    },

    async read(path: string): Promise<string | undefined> {
      try {
        return await client.getFileContents({ ...repository, path, ref: sha });
      } catch (error: unknown) {
        if (httpStatus(error) === 404) {
          return undefined;
        }
        throw error;
      }
    },
  };
}
