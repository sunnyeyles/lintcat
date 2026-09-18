/** describeArea over a built index: known paths, unknown paths, and the caps. */
import { describe, expect, it } from "vitest";

import { buildLayerA } from "./build.js";
import { createInMemoryIndex } from "./memory.js";
import { MAX_SIBLINGS, type FileSource } from "./types.js";

const FILES: Record<string, string> = {
  "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
  "package.json": JSON.stringify({ name: "root", private: true }),
  CODEOWNERS: "packages/api/** @org/api\n",
  "packages/api/package.json": JSON.stringify({ name: "@acme/api", main: "src/index.ts" }),
  "packages/api/src/index.ts": "",
  "packages/api/src/routes.ts": "",
  "packages/api/src/routes.test.ts": "",
  "README.md": "",
};
for (let n = 0; n < 40; n += 1) {
  FILES[`packages/api/src/gen/f${n}.ts`] = "";
}

const source: FileSource = {
  sha: "abc123",
  listPaths: () => Promise.resolve({ paths: Object.keys(FILES).sort(), truncated: false }),
  read: (path: string) => Promise.resolve(FILES[path]),
};

const index = createInMemoryIndex(
  await buildLayerA(source, new Date("2026-02-03T04:05:06.000Z")),
);

describe("createInMemoryIndex", () => {
  it("reports the build it serves", async () => {
    const status = await index.status();
    expect(status.sha).toBe("abc123");
    expect(status.builtAt).toBe("2026-02-03T04:05:06.000Z");
    expect(status.coverage.files).toBe(Object.keys(FILES).length);
  });

  it("fills every field for a known path", async () => {
    const area = await index.describeArea("packages/api/src/routes.ts");
    expect(area).toEqual({
      path: "packages/api/src/routes.ts",
      known: true,
      package: {
        name: "@acme/api",
        root: "packages/api",
        entryPoints: ["packages/api/src/index.ts"],
        dependsOn: [],
      },
      role: "source",
      language: "typescript",
      owners: ["@org/api"],
      tests: ["packages/api/src/routes.test.ts"],
      covers: [],
      siblings: [
        "packages/api/src/index.ts",
        "packages/api/src/routes.test.ts",
      ],
      siblingsTotal: 2,
    });
  });

  it("reports what a test file covers", async () => {
    const area = await index.describeArea("packages/api/src/routes.test.ts");
    expect(area.role).toBe("test");
    expect(area.covers).toEqual(["packages/api/src/routes.ts"]);
    expect(area.tests).toEqual([]);
  });

  it("caps siblings while keeping the total exact", async () => {
    const area = await index.describeArea("packages/api/src/gen/f0.ts");
    expect(area.siblings).toHaveLength(MAX_SIBLINGS);
    expect(area.siblingsTotal).toBe(39);
    expect(area.siblings[0]).toBe("packages/api/src/gen/f1.ts");
  });

  it("answers an unknown path with its package and its directory", async () => {
    const area = await index.describeArea("packages/api/src/added.ts");
    expect(area.known).toBe(false);
    expect(area.package?.name).toBe("@acme/api");
    expect(area.role).toBeNull();
    expect(area.language).toBeNull();
    expect(area.owners).toEqual([]);
    expect(area.tests).toEqual([]);
    expect(area.siblings).toContain("packages/api/src/routes.ts");
    expect(area.siblingsTotal).toBe(3);
  });

  it("answers an unknown directory with nothing", async () => {
    const area = await index.describeArea("apps/web/src/page.tsx");
    expect(area.known).toBe(false);
    expect(area.package).toBeNull();
    expect(area.siblings).toEqual([]);
    expect(area.siblingsTotal).toBe(0);
  });

  it("rejects absolute and traversing paths", async () => {
    for (const path of ["/etc/passwd", "../secrets.ts", "packages/api/../../x.ts", ""]) {
      const area = await index.describeArea(path);
      expect(area.known).toBe(false);
      expect(area.package).toBeNull();
      expect(area.siblings).toEqual([]);
    }
  });
});
