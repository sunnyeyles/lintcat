import { describe, expect, it } from "vitest";

import { loadConfig } from "#src/config";
import { runGate } from "#src/gate";
import { buildGraph } from "#src/graph";
import type { PackageMetrics, PackageScan, PackageSnapshot, Snapshot } from "#src/snapshot";
import type { Workspace } from "#src/workspaces";

const config = loadConfig();

function ws(name: string, dir: string): Workspace {
  return { name, dir, path: dir, kind: dir.startsWith("packages") ? "package" : "app", dependencies: [], external: {}, externalDev: {}, exports: ["."] };
}

const graph = buildGraph([ws("@x/lib", "packages/lib"), ws("@x/app", "apps/app")]);

function scan(categories: Record<string, Record<string, number>>): PackageScan {
  const out: PackageScan = { files: 1, lines: 1, categories: {} };
  for (const [name, files] of Object.entries(categories)) {
    const count = name === "long-file" ? Object.keys(files).length : Object.values(files).reduce((a, b) => a + b, 0);
    out.categories[name] = { count, files };
  }
  return out;
}

function metrics(over: Partial<PackageMetrics> = {}): PackageMetrics {
  return {
    tests: { files: 1, tests: 10, passed: 10, failed: 0 },
    coverage: { lines: 80, statements: 80, branches: 70, functions: 75 },
    typecheck: { errors: 0 },
    lint: { errors: 0, warnings: 0 },
    deadCode: null,
    deps: { workspace: 0, external: 0, externalDev: 0 },
    bundleBytes: 1000,
    ...over,
  };
}

function snap(pkg: Partial<PackageSnapshot>): Snapshot {
  const base: PackageSnapshot = { package: "@x/lib", dir: "packages/lib", exports: [".", "./extra"], scan: scan({}), metrics: metrics() };
  const merged = { ...base, ...pkg };
  return { packages: { [merged.package]: merged }, overall: { audit: null, outdated: null, duplicateVersions: null, lockfilePackages: null } };
}

const opts = { packages: ["@x/lib"], allowApiChange: false };

describe("runGate", () => {
  it("is green and lists the package as unbaselined when no baseline exists", () => {
    const r = runGate(null, snap({}), graph, config, opts);
    expect(r.ok).toBe(true);
    expect(r.unbaselined).toEqual(["@x/lib"]);
  });

  it("fails when a category count rises or a hit appears in a new file without a net fall", () => {
    const before = snap({ scan: scan({ "non-null-assertion": { "packages/lib/src/a.ts": 2 } }) });
    const rose = snap({ scan: scan({ "non-null-assertion": { "packages/lib/src/a.ts": 3 } }) });
    expect(runGate(before, rose, graph, config, opts).findings.map((f) => f.level)).toContain("fail");

    const moved = snap({ scan: scan({ "non-null-assertion": { "packages/lib/src/a.ts": 1, "packages/lib/src/b.ts": 1 } }) });
    expect(runGate(before, moved, graph, config, opts).ok).toBe(false);

    const netFall = snap({ scan: scan({ "non-null-assertion": { "packages/lib/src/b.ts": 1 } }) });
    const r = runGate(before, netFall, graph, config, opts);
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.level).sort()).toEqual(["info", "warn"]);
  });

  it("lets an existing long file grow only within the tolerance", () => {
    const before = snap({ scan: scan({ "long-file": { "packages/lib/src/big.ts": 500 } }) });
    expect(runGate(before, snap({ scan: scan({ "long-file": { "packages/lib/src/big.ts": 520 } }) }), graph, config, opts).ok).toBe(true);
    expect(runGate(before, snap({ scan: scan({ "long-file": { "packages/lib/src/big.ts": 560 } }) }), graph, config, opts).ok).toBe(false);
  });

  it("fails on coverage drops, failing tests, bundle growth and new type errors", () => {
    const before = snap({});
    const checks = (over: Partial<PackageMetrics>) =>
      runGate(before, snap({ metrics: metrics(over) }), graph, config, opts)
        .findings.filter((f) => f.level === "fail")
        .map((f) => f.check);
    expect(checks({ coverage: { lines: 79, statements: 79, branches: 70, functions: 75 } })).toEqual(["coverage"]);
    expect(checks({ coverage: { lines: 79.7, statements: 79, branches: 70, functions: 75 } })).toEqual([]);
    expect(checks({ tests: { files: 1, tests: 10, passed: 9, failed: 1 } })).toEqual(["tests"]);
    expect(checks({ bundleBytes: 1060 })).toEqual(["bundle"]);
    expect(checks({ bundleBytes: 1040 })).toEqual([]);
    expect(checks({ typecheck: { errors: 1 } })).toEqual(["typecheck"]);
  });

  it("treats a removed export of a shared package as a failure unless allowed", () => {
    const before = snap({});
    const now = snap({ exports: ["."] });
    expect(runGate(before, now, graph, config, opts).findings[0]).toMatchObject({ level: "fail", check: "public-api" });
    expect(runGate(before, now, graph, config, { ...opts, allowApiChange: true }).ok).toBe(true);
  });

  it("ignores packages outside the selection", () => {
    const before = snap({ scan: scan({ marker: { "packages/lib/src/a.ts": 1 } }) });
    const now = snap({ scan: scan({ marker: { "packages/lib/src/a.ts": 5 } }) });
    expect(runGate(before, now, graph, config, { packages: ["@x/app"], allowApiChange: false }).ok).toBe(true);
  });
});
