/** The one find-references query, through its own interface. */
import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import {
  findReferences,
  findReferencesDescription,
  indexHeader,
  MAX_REFERENCE_FILES,
  renderFindReferences,
  UNINDEXED_PATH_REASON,
} from "#src/find-references";

const sha = "0000000000000000000000000000000000000000";

function index(files: Record<string, string>) {
  return buildRepositoryIndex({ sha, files: new Map(Object.entries(files)) });
}

const sessions = index({
  "src/sessions.ts": "export const sessions = [];\nexport function createSession() {}\n",
  "src/admin.ts": 'import * as sessions from "./sessions";\n',
  "src/api.ts": 'import { createSession } from "./sessions";\n',
  "src/boot.ts": 'import "./sessions";\n',
  "README.md": "# readme\n",
});

describe("findReferences", () => {
  it("lists every importing file, with the line each import sits on", () => {
    const result = findReferences(sessions, { path: "src/sessions.ts" });

    expect(result).toMatchObject({
      path: "src/sessions.ts",
      known: true,
      total: 3,
      references: [
        { path: "src/admin.ts", imports: [{ line: 1, kind: "namespace", name: "*" }] },
        { path: "src/api.ts", imports: [{ line: 1, kind: "named", name: "createSession" }] },
        { path: "src/boot.ts", imports: [{ line: 1, kind: "side-effect" }] },
      ],
    });
    expect(result).not.toHaveProperty("name");
  });

  it("narrows to one name, keeping the namespace importer that can see it", () => {
    const result = findReferences(sessions, {
      path: "src/sessions.ts",
      name: "createSession",
    });

    expect(result).toMatchObject({ name: "createSession", known: true, total: 2 });
    expect(result).toMatchObject({
      references: [{ path: "src/admin.ts" }, { path: "src/api.ts" }],
    });
  });

  it("returns an empty list for an indexed file nothing imports", () => {
    expect(findReferences(sessions, { path: "src/boot.ts" })).toMatchObject({
      known: true,
      total: 0,
      references: [],
    });
  });

  it("reports the true total while returning at most the cap", () => {
    const files: Record<string, string> = {
      "src/wide.ts": "export const wide = 1;\n",
    };
    for (let at = 0; at < MAX_REFERENCE_FILES + 10; at += 1) {
      files[`src/caller-${String(at).padStart(3, "0")}.ts`] = 'import { wide } from "./wide";\n';
    }

    const result = findReferences(index(files), { path: "src/wide.ts" });

    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.total).toBe(MAX_REFERENCE_FILES + 10);
    expect(result.references).toHaveLength(MAX_REFERENCE_FILES);
  });

  it("carries the index header on every result", () => {
    const header = {
      sha,
      files: 5,
      truncated: false,
      languages: expect.arrayContaining([
        expect.objectContaining({ language: "typescript", indexed: true }),
        expect.objectContaining({ language: "markdown", indexed: false }),
      ]),
    };

    expect(findReferences(sessions, { path: "src/sessions.ts" }).index).toEqual(header);
    expect(findReferences(sessions, { path: "src/gone.ts" }).index).toEqual(header);
    expect(indexHeader(sessions)).toEqual(header);
  });

  it("calls a path it does not hold unknown, never non-existent", () => {
    const result = findReferences(sessions, { path: "src/gone.ts" });

    expect(result).toMatchObject({
      path: "src/gone.ts",
      known: false,
      reason: UNINDEXED_PATH_REASON,
    });
    expect(JSON.stringify(result)).not.toMatch(/does not exist/);
  });

  it("prefers a reason only the caller can know", () => {
    const result = findReferences(sessions, {
      path: "src/sessions.ts",
      absentReason: "added by this pull request",
    });

    expect(result).toMatchObject({ known: false, reason: "added by this pull request" });
  });
});

describe("renderFindReferences", () => {
  it("renders indented JSON that parses back to the result", () => {
    const result = findReferences(sessions, { path: "src/sessions.ts" });
    const text = renderFindReferences(result);

    expect(JSON.parse(text)).toEqual(result);
    expect(text).toContain("\n  ");
  });

  it("puts the index header first, so a truncated tail cannot hide it", () => {
    expect(renderFindReferences(findReferences(sessions, { path: "src/gone.ts" })))
      .toMatch(/^\{\n {2}"index":/);
  });
});

describe("findReferencesDescription", () => {
  it("names the caller's scope and the one cap", () => {
    const description = findReferencesDescription("the pull request's BASE commit");

    expect(description).toContain("the pull request's BASE commit");
    expect(description).toContain(`At most ${MAX_REFERENCE_FILES} files`);
  });
});
