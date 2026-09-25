/** Blame as every adapter returns it: one range per run of lines a single commit wrote. */
import type { BlameRange } from "#src/client";

interface CommitRun extends BlameRange {
  commit: string;
}

/** Sorts runs by line and joins each pair of touching runs one commit wrote. */
export function joinCommitRuns(runs: readonly CommitRun[]): BlameRange[] {
  const joined: CommitRun[] = [];
  for (const run of [...runs].sort((a, b) => a.startLine - b.startLine)) {
    const last = joined.at(-1);
    if (last?.commit === run.commit && last.endLine + 1 === run.startLine) {
      last.endLine = run.endLine;
    } else {
      joined.push({ ...run });
    }
  }
  return joined.map(({ startLine, endLine, login, author, committedAt }) => ({
    startLine,
    endLine,
    login,
    author,
    committedAt,
  }));
}

/** git allows an empty author name, and GitHub a null one. */
export function blameAuthor(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  return name?.trim() || email?.trim() || "unknown";
}

const PORCELAIN_HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/;

/** Reads `git blame --porcelain`, which details a commit only on the first line it blames. */
export function parseBlamePorcelain(output: string): BlameRange[] {
  const commits = new Map<string, Map<string, string>>();
  const lines: { commit: string; line: number }[] = [];
  let fields: Map<string, string> | undefined;

  for (const text of output.split("\n")) {
    if (text.startsWith("\t")) {
      fields = undefined;
      continue;
    }
    const header = PORCELAIN_HEADER.exec(text);
    if (header) {
      const commit = header[1]!;
      lines.push({ commit, line: Number(header[2]) });
      fields = commits.get(commit) ?? new Map<string, string>();
      commits.set(commit, fields);
      continue;
    }
    if (fields !== undefined && text !== "") {
      const space = text.indexOf(" ");
      fields.set(
        space === -1 ? text : text.slice(0, space),
        space === -1 ? "" : text.slice(space + 1),
      );
    }
  }

  return joinCommitRuns(
    lines.map(({ commit, line }) => {
      const details = commits.get(commit);
      const seconds = Number(details?.get("committer-time"));
      if (details === undefined || !Number.isFinite(seconds)) {
        throw new Error(`git blame gave commit ${commit} no committer-time`);
      }
      return {
        commit,
        startLine: line,
        endLine: line,
        login: null,
        author: blameAuthor(
          details.get("author"),
          details.get("author-mail")?.replace(/^<(.*)>$/, "$1"),
        ),
        committedAt: new Date(seconds * 1000).toISOString(),
      };
    }),
  );
}
