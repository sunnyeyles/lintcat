import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadBaseline, mergeIntoBaseline, saveBaseline } from "#src/baseline";
import type { Snapshot } from "#src/snapshot";
import { stableJson } from "#src/snapshot";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function snapshot(names: string[]): Snapshot {
  const packages: Snapshot["packages"] = {};
  for (const name of names) {
    packages[name] = { package: name, dir: `packages/${name}`, exports: ["."], scan: { files: 1, lines: 1, categories: {} }, metrics: null };
  }
  return { packages, overall: { audit: null, outdated: 3, duplicateVersions: 1, lockfilePackages: 10 } };
}

describe("baseline files", () => {
  it("round-trips one file per package plus overall and meta", () => {
    dir = mkdtempSync(path.join(tmpdir(), "debt-baseline-"));
    const written = saveBaseline(dir, snapshot(["a", "b"]), { commit: "abc", reason: "test" });
    expect(written.sort()).toEqual(["_meta.json", "_overall.json", "packages-a.json", "packages-b.json"]);
    expect(loadBaseline(dir)).toEqual(snapshot(["a", "b"]));
    expect(JSON.parse(readFileSync(path.join(dir, "_meta.json"), "utf8"))).toMatchObject({ commit: "abc", reason: "test" });
  });

  it("merges a scoped snapshot over the previous baseline", () => {
    dir = mkdtempSync(path.join(tmpdir(), "debt-baseline-"));
    const merged = mergeIntoBaseline(snapshot(["a", "b"]), snapshot(["b"]));
    expect(Object.keys(merged.packages).sort()).toEqual(["a", "b"]);
    saveBaseline(dir, merged, { commit: "x", reason: "y" });
    expect(readdirSync(dir).filter((f) => !f.startsWith("_"))).toHaveLength(2);
  });

  it("returns null for an empty directory", () => {
    dir = mkdtempSync(path.join(tmpdir(), "debt-baseline-"));
    expect(loadBaseline(dir)).toBeNull();
  });
});

describe("stableJson", () => {
  it("sorts keys at every level", () => {
    expect(stableJson({ b: { z: 1, a: [{ y: 1, x: 2 }] }, a: 0 })).toBe(
      `${JSON.stringify({ a: 0, b: { a: [{ x: 2, y: 1 }], z: 1 } }, null, 2)}\n`,
    );
  });
});
