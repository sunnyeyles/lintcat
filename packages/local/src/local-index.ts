import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";

import { buildRepositoryIndex, type RepositoryIndex } from "@pr-review/index";

import { git } from "#src/git";
import { openLocalRepository, WORKING_TREE } from "#src/local-git-client";

/** HEAD, the dirty paths and their mtimes: changes whenever the working tree does. */
async function workingTreeKey(root: string): Promise<string> {
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const hash = createHash("sha1").update(head).update(status);
  for (const entry of status.split("\0")) {
    const file = entry.slice(3);
    if (file === "") continue;
    try {
      hash.update(String(statSync(path.join(root, file)).mtimeMs));
    } catch {
      hash.update("gone");
    }
  }
  return hash.digest("hex");
}

export interface LocalIndex {
  root: string;
  index: RepositoryIndex;
}

/** One index per checkout, rebuilt only when its working tree has moved. */
export function createLocalIndexCache(): (repoPath: string) => Promise<LocalIndex> {
  const cache = new Map<string, { key: string; index: Promise<RepositoryIndex> }>();

  return async (repoPath) => {
    const { root, owner, repo, client } = await openLocalRepository(repoPath, "HEAD");
    const key = await workingTreeKey(root);
    let entry = cache.get(root);
    if (entry?.key !== key) {
      const index = client
        .getRepositoryArchive({ owner, repo, ref: WORKING_TREE })
        .then((archive) => buildRepositoryIndex(archive));
      const created = { key, index };
      entry = created;
      cache.set(root, created);
      index.catch(() => {
        if (cache.get(root) === created) cache.delete(root);
      });
    }
    return { root, index: await entry.index };
  };
}
