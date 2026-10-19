export interface CategoryHits {
  count: number;
  files: Record<string, number>;
}

export interface PackageScan {
  files: number;
  lines: number;
  categories: Record<string, CategoryHits>;
}

export interface Coverage {
  lines: number;
  statements: number;
  branches: number;
  functions: number;
}

export interface PackageMetrics {
  tests: { files: number; tests: number; passed: number; failed: number } | null;
  coverage: Coverage | null;
  typecheck: { errors: number } | null;
  lint: { errors: number; warnings: number } | null;
  deadCode: { files: number; exports: number; types: number; dependencies: number } | null;
  deps: { workspace: number; external: number; externalDev: number };
  bundleBytes: number | null;
}

export interface OverallMetrics {
  audit: Record<string, number> | null;
  outdated: number | null;
  duplicateVersions: number | null;
  lockfilePackages: number | null;
}

export interface PackageSnapshot {
  package: string;
  dir: string;
  exports: string[];
  scan: PackageScan;
  metrics: PackageMetrics | null;
}

export interface Snapshot {
  packages: Record<string, PackageSnapshot>;
  overall: OverallMetrics;
}

// Sorted keys and no timestamps, so an unchanged tree produces a byte-identical file.
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function baselineFileName(dir: string): string {
  return `${dir.replace(/\//g, "-")}.json`;
}
