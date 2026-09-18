/** Test → source mapping, per language convention. */
import { describe, expect, it } from "vitest";

import type { FileRecord } from "../types.js";
import { languageOf } from "./languages.js";
import { roleOf } from "./roles.js";
import { testEdges } from "./tests.js";

function files(...paths: string[]): FileRecord[] {
  return paths.sort().map((path) => {
    const language = languageOf(path);
    return { path, package: null, role: roleOf(path, language), language, owners: [] };
  });
}

describe("testEdges", () => {
  it("maps a sibling test to the source of the same extension", () => {
    expect(testEdges(files("src/tools.ts", "src/tools.test.ts"))).toEqual([
      { test: "src/tools.test.ts", source: "src/tools.ts" },
    ]);
  });

  it("falls back to another source extension present", () => {
    expect(testEdges(files("src/parse.js", "src/parse.spec.ts"))).toEqual([
      { test: "src/parse.spec.ts", source: "src/parse.js" },
    ]);
  });

  it("looks one directory up out of __tests__", () => {
    expect(testEdges(files("src/client.ts", "src/__tests__/client.test.ts"))).toEqual([
      { test: "src/__tests__/client.test.ts", source: "src/client.ts" },
    ]);
  });

  it("maps python tests beside their source", () => {
    expect(testEdges(files("app/models.py", "app/test_models.py"))).toEqual([
      { test: "app/test_models.py", source: "app/models.py" },
    ]);
  });

  it("maps a python test to the one file of that name in the repository", () => {
    expect(testEdges(files("src/app/models.py", "tests/test_models.py"))).toEqual([
      { test: "tests/test_models.py", source: "src/app/models.py" },
    ]);
  });

  it("gives up when the python name is ambiguous", () => {
    expect(
      testEdges(files("a/models.py", "b/models.py", "tests/test_models.py")),
    ).toEqual([]);
  });

  it("maps a go test to its own directory only", () => {
    expect(testEdges(files("internal/store/db.go", "internal/store/db_test.go"))).toEqual([
      { test: "internal/store/db_test.go", source: "internal/store/db.go" },
    ]);
    expect(testEdges(files("store/db.go", "internal/db_test.go"))).toEqual([]);
  });

  it("emits nothing when the source is missing", () => {
    expect(testEdges(files("src/gone.test.ts"))).toEqual([]);
  });

  it("orders edges by the file listing", () => {
    expect(
      testEdges(files("src/b.ts", "src/b.test.ts", "src/a.ts", "src/a.test.ts")).map(
        (edge) => edge.test,
      ),
    ).toEqual(["src/a.test.ts", "src/b.test.ts"]);
  });
});
