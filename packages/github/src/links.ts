// Dependency-free so client components can import it.

/** A repository at one commit, which file links point into. */
export type CommitRef = { owner: string; repo: string; sha: string };

export function blobUrl({ owner, repo, sha }: CommitRef, file: string, line: number): string {
  const path = file.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${owner}/${repo}/blob/${sha}/${path}#L${line}`;
}
