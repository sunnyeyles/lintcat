/** The snapshot is a projection of a built index, not a second computation. */
import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import {
  decodeRepositoryGraph,
  encodeRepositoryGraph,
  snapshotRepositoryIndex,
} from "#src/snapshot";

const sha = "0000000000000000000000000000000000000000";

const files = new Map([
  [
    "package.json",
    JSON.stringify({ name: "widgets", workspaces: ["packages/*"] }),
  ],
  ["src/session.ts", "export const session = 1;\n"],
  [
    "src/login.ts",
    "import { session } from './session';\nimport React from 'react';\nexport const login = session;\n",
  ],
  ["src/session.test.ts", "import { session } from './session';\n"],
]);

function snapshotOf(truncated = false) {
  return snapshotRepositoryIndex(
    buildRepositoryIndex({ sha, files, truncated }),
  );
}

describe("snapshotRepositoryIndex", () => {
  it("carries the sha, the truncated marker and every indexed file", () => {
    const snapshot = snapshotOf(true);
    expect(snapshot.sha).toBe(sha);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.files.map((file) => file.path)).toEqual(
      [...files.keys()].sort(),
    );
  });

  it("copies each file's fields exactly as the index holds them", () => {
    const index = buildRepositoryIndex({ sha, files });
    const snapshot = snapshotRepositoryIndex(index);
    for (const file of snapshot.files) {
      expect(file).toEqual(index.files.get(file.path));
    }
    expect(
      snapshot.files.find((file) => file.path === "src/session.ts"),
    ).toMatchObject({
      role: "source",
      language: "typescript",
      importerCount: 2,
      coveredBy: "src/session.test.ts",
    });
  });

  it("keeps resolved edges with their imported names and drops the rest", () => {
    const snapshot = snapshotOf();
    expect(snapshot.edges).toEqual([
      {
        from: "src/login.ts",
        to: "src/session.ts",
        names: [{ kind: "named", name: "session" }],
      },
      {
        from: "src/session.test.ts",
        to: "src/session.ts",
        names: [{ kind: "named", name: "session" }],
      },
    ]);
  });

  it("carries the workspace's own packages", () => {
    expect(snapshotOf().packages).toEqual(
      buildRepositoryIndex({ sha, files }).packages,
    );
  });

  it("passes any later field on an indexed file straight through", () => {
    const index = buildRepositoryIndex({ sha, files });
    const flagged = index.files.get("src/login.ts")!;
    (flagged as unknown as Record<string, unknown>)["entrypoint"] = true;
    expect(
      snapshotRepositoryIndex(index).files.find(
        (file) => file.path === "src/login.ts",
      ),
    ).toHaveProperty("entrypoint", true);
  });

  it("survives a JSON round trip unchanged", () => {
    const snapshot = snapshotOf(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe("encodeRepositoryGraph", () => {
  it("round-trips the snapshot through gzip", () => {
    const snapshot = snapshotOf(true);
    expect(decodeRepositoryGraph(encodeRepositoryGraph(snapshot))).toEqual(
      snapshot,
    );
  });

  it("round-trips through base64, which is how it travels", () => {
    const snapshot = snapshotOf();
    const base64 = Buffer.from(encodeRepositoryGraph(snapshot)).toString(
      "base64",
    );
    expect(decodeRepositoryGraph(Buffer.from(base64, "base64"))).toEqual(
      snapshot,
    );
  });

  it("is smaller than the JSON it encodes", () => {
    const snapshot = snapshotOf();
    expect(encodeRepositoryGraph(snapshot).byteLength).toBeLessThan(
      JSON.stringify(snapshot).length,
    );
  });
});
