/** The opening block: one line per changed file, and the absent case. */
import { describe, expect, it } from "vitest";

import { buildLayerA } from "./build.js";
import { createInMemoryIndex } from "./memory.js";
import { MAX_INDEX_LINES, renderRepositoryIndexBlock } from "./opening-block.js";
import type { FileSource } from "./types.js";

const LAYER_B = {
  symbols: [],
  references: [],
  imports: [
    { from: "packages/api/src/handlers.ts", to: "packages/api/src/routes.ts" },
    { from: "packages/api/src/server.ts", to: "packages/api/src/routes.ts" },
  ],
  coverage: [
    { language: "typescript", files: 3, indexed: true, resolutionRate: 1 },
  ],
};

const FILES: Record<string, string> = {
  "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
  "package.json": JSON.stringify({ name: "root", private: true }),
  CODEOWNERS: "packages/api/** @org/api\n",
  "packages/api/package.json": JSON.stringify({ name: "@acme/api" }),
  "packages/api/src/routes.ts": "",
  "packages/api/src/routes.test.ts": "",
  "README.md": "",
};

const source: FileSource = {
  sha: "abc123",
  listPaths: () => Promise.resolve({ paths: Object.keys(FILES).sort(), truncated: false }),
  read: (path: string) => Promise.resolve(FILES[path]),
};

const BUILT_AT = new Date("2026-02-03T01:00:00.000Z");
const NOW = new Date("2026-02-03T04:05:00.000Z");

const index = createInMemoryIndex(await buildLayerA(source, BUILT_AT));

describe("renderRepositoryIndexBlock", () => {
  it("renders one line per changed file", async () => {
    const block = await renderRepositoryIndexBlock(
      index,
      ["packages/api/src/routes.ts", "README.md", "packages/api/src/added.ts"],
      NOW,
    );

    expect(block).toBe(
      [
        '<repository_index sha="abc123" age_hours="3">',
        "- packages/api/src/routes.ts — @acme/api, source, tested by routes.test.ts, owners @org/api",
        "- README.md — no package, docs",
        "- packages/api/src/added.ts — @acme/api (not in index)",
        "</repository_index>",
      ].join("\n"),
    );
  });

  it("counts importers per file once Layer B is there", async () => {
    const withGraph = createInMemoryIndex({
      ...(await buildLayerA(source, BUILT_AT)),
      layerB: LAYER_B,
    });
    const block = await renderRepositoryIndexBlock(
      withGraph,
      ["packages/api/src/routes.ts", "README.md"],
      NOW,
    );

    expect(block.split("\n").slice(1, 3)).toEqual([
      "- packages/api/src/routes.ts — @acme/api, source, tested by routes.test.ts, owners @org/api, 2 importers",
      "- README.md — no package, docs, 0 importers",
    ]);
  });

  it("says so when there is no index", async () => {
    expect(await renderRepositoryIndexBlock(undefined, ["a.ts"])).toBe(
      '<repository_index status="absent">no repository index for this review</repository_index>',
    );
  });

  it("caps the listing and counts the rest", async () => {
    const changed = Array.from(
      { length: MAX_INDEX_LINES + 5 },
      (_, n) => `packages/api/src/f${n}.ts`,
    );
    const lines = (await renderRepositoryIndexBlock(index, changed, NOW)).split("\n");

    expect(lines).toHaveLength(MAX_INDEX_LINES + 3);
    expect(lines.at(-2)).toBe("- [... 5 more files]");
    expect(lines.at(-1)).toBe("</repository_index>");
  });

  it("never reports a negative age", async () => {
    const block = await renderRepositoryIndexBlock(index, [], new Date("2026-01-01T00:00:00.000Z"));
    expect(block.split("\n")[0]).toBe('<repository_index sha="abc123" age_hours="0">');
  });
});
