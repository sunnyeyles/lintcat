/** The porcelain reader the local checkout blames through, and the fields every adapter shares. */
import { describe, expect, it } from "vitest";

import { blameAuthor, joinCommitRuns, parseBlamePorcelain } from "#src/blame";

const FIRST = "be28c25b04ede4be3d110cd703132293fb86e0d6";
const SECOND = "af459b9d65233fee9dde9fb8c09e0c287d9936e5";

function details(author: string, mail: string, authored: number, committed: number): string[] {
  return [
    `author ${author}`,
    `author-mail <${mail}>`,
    `author-time ${authored}`,
    "author-tz +1000",
    `committer ${author}`,
    `committer-mail <${mail}>`,
    `committer-time ${committed}`,
    "committer-tz +1000",
    "summary a commit",
  ];
}

/** SECOND rewrote line 2 of FIRST's five and deleted line 4, as git 2.43 prints it. */
const PORCELAIN = [
  `${FIRST} 1 1 1`,
  ...details("Ada Lovelace", "ada@example.com", 1767225000, 1767225600),
  "boundary",
  "filename f.txt",
  "\ta",
  `${SECOND} 2 2 1`,
  ...details("", "bob@example.com", 1767312000, 1767312000),
  `previous ${FIRST} f.txt`,
  "filename f.txt",
  "\tB",
  `${FIRST} 3 3 1`,
  "\tc",
  `${FIRST} 5 4 1`,
  "\te",
  "",
].join("\n");

describe("parseBlamePorcelain", () => {
  it("joins touching lines one commit wrote, even from lines it did not write together", () => {
    expect(parseBlamePorcelain(PORCELAIN)).toEqual([
      {
        startLine: 1,
        endLine: 1,
        login: null,
        author: "Ada Lovelace",
        committedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        startLine: 2,
        endLine: 2,
        login: null,
        author: "bob@example.com",
        committedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        startLine: 3,
        endLine: 4,
        login: null,
        author: "Ada Lovelace",
        committedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("reads a group's later lines, and never mistakes a line's text for a header", () => {
    const output = [
      `${FIRST} 1 1 3`,
      ...details("Ada Lovelace", "ada@example.com", 1767225600, 1767225600),
      "filename f.txt",
      `\t${SECOND} 9 9 1`,
      `${FIRST} 2 2`,
      "\tauthor Mallory",
      `${FIRST} 3 3`,
      "\t",
      "",
    ].join("\n");

    expect(parseBlamePorcelain(output)).toEqual([
      {
        startLine: 1,
        endLine: 3,
        login: null,
        author: "Ada Lovelace",
        committedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseBlamePorcelain("")).toEqual([]);
  });

  it("rejects output that never says when a commit was made", () => {
    expect(() => parseBlamePorcelain(`${FIRST} 1 1 1\nauthor Ada\n\ta\n`)).toThrow(
      /committer-time/,
    );
  });
});

describe("joinCommitRuns", () => {
  const run = (commit: string, startLine: number, endLine: number) => ({
    commit,
    startLine,
    endLine,
    login: null,
    author: commit,
    committedAt: "2026-01-01T00:00:00.000Z",
  });

  it("orders runs by line and keeps a gap between two runs of one commit", () => {
    const joined = joinCommitRuns([run("b", 4, 6), run("a", 1, 2), run("a", 3, 3), run("a", 8, 9)]);

    expect(joined.map(({ startLine, endLine, author }) => [startLine, endLine, author])).toEqual([
      [1, 3, "a"],
      [4, 6, "b"],
      [8, 9, "a"],
    ]);
  });
});

describe("blameAuthor", () => {
  it("prefers the name, then the email, then says it does not know", () => {
    expect(blameAuthor("Ada Lovelace", "ada@example.com")).toBe("Ada Lovelace");
    expect(blameAuthor(" ", "ada@example.com")).toBe("ada@example.com");
    expect(blameAuthor(null, null)).toBe("unknown");
  });
});
