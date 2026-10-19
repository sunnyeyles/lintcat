import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "#src/config";
import { scanWorkspace } from "#src/scan/scan";
import { workspaceFromDir } from "#src/workspaces";

const config = loadConfig();
let root: string;

function file(rel: string, text: string) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function pkg(dir: string, name: string) {
  file(`${dir}/package.json`, JSON.stringify({ name, exports: { ".": "./src/index.ts" } }));
  return workspaceFromDir(root, dir)!;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scanWorkspace", () => {
  it("counts line rules only in code and skips excluded and test files where told", () => {
    root = mkdtempSync(path.join(tmpdir(), "debt-scan-"));
    const w = pkg("packages/alpha", "@x/alpha");
    file("packages/alpha/src/a.ts", 'const a = arr[0]!;\n// TODO later\nconst s = "wow!";\n');
    file("packages/alpha/src/a.test.ts", "// @ts-expect-error\nconsole.log(x!);\n");
    file("packages/alpha/src/b.ts", "console.log(1);\n// @ts-expect-error\n");
    file("packages/alpha/dist/ignored.ts", "const z = y!;\n");

    const scan = scanWorkspace(root, w, config);
    expect(scan.files).toBe(3);
    expect(scan.categories["non-null-assertion"]).toEqual({ count: 2, files: { "packages/alpha/src/a.ts": 1, "packages/alpha/src/a.test.ts": 1 } });
    expect(scan.categories["marker"]!.count).toBe(1);
    expect(scan.categories["ts-expect-error"]!.files).toEqual({ "packages/alpha/src/b.ts": 1 });
    expect(scan.categories["console-outside-logging"]!.files).toEqual({ "packages/alpha/src/b.ts": 1 });
  });

  it("flags untested modules and long files with separate thresholds", () => {
    root = mkdtempSync(path.join(tmpdir(), "debt-scan-"));
    const w = pkg("packages/beta", "@x/beta");
    file("packages/beta/src/index.ts", "export {};\n");
    file("packages/beta/src/tested.ts", "export const t = 1;\n");
    file("packages/beta/src/tested.test.ts", `${"it();\n".repeat(500)}`);
    file("packages/beta/src/lonely.ts", `${"x();\n".repeat(401)}`);

    const scan = scanWorkspace(root, w, config);
    expect(Object.keys(scan.categories["untested-module"]!.files)).toEqual(["packages/beta/src/lonely.ts"]);
    expect(scan.categories["long-file"]!.files).toEqual({ "packages/beta/src/lonely.ts": 402 });
  });

  it("does not flag console output in packages the rule excludes", () => {
    root = mkdtempSync(path.join(tmpdir(), "debt-scan-"));
    const w = pkg("packages/logging", "@pr-review/logging");
    file("packages/logging/src/index.ts", "console.log(1);\n");
    expect(scanWorkspace(root, w, config).categories["console-outside-logging"]!.count).toBe(0);
  });
});
