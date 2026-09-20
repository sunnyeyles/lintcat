/** The local-checkout adapter against a throwaway repository on disk. */
import { afterAll, beforeAll } from "vitest";

import { runClientConformance, type ConformanceCase } from "@pr-review/github/conformance";

import { openLocalRepository, type LocalRepository } from "#src/local-git-client";
import { createTestRepo, type TestRepo } from "#src/test-repo";

const UNIQUE_PATH = "src/unique.ts";
const UNIQUE_CONTENTS = "export const uniqueToken = 1;\n";
const FLOOD_FILES = 35;

const REPEATED_CONTENTS = Array.from(
  { length: 5 },
  (_, i) => `export const repeatedToken${i} = ${i};\n`,
).join("");

const FILES: Record<string, string> = {
  [UNIQUE_PATH]: UNIQUE_CONTENTS,
  "src/repeated.ts": REPEATED_CONTENTS,
  "src/api.ts": "export const api = 1;\n",
  ...Object.fromEntries(
    Array.from({ length: FLOOD_FILES }, (_, i) => [
      `src/flood-${String(i).padStart(2, "0")}.ts`,
      `export const floodToken = ${i};\n`,
    ]),
  ),
};

let repo: TestRepo;
let local: LocalRepository;

beforeAll(async () => {
  repo = createTestRepo(FILES);
  repo.git("checkout", "-q", "-b", "feature");
  repo.write("src/api.ts", "export const api = 2;\n");
  local = await openLocalRepository(repo.root, "main");
});

afterAll(() => repo.remove());

function openCase(): ConformanceCase {
  return {
    client: local.client,
    ref: local.target,
    changedFilenames: ["src/api.ts"],
    file: { path: UNIQUE_PATH, ref: local.baseSha, contents: UNIQUE_CONTENTS },
    missingPath: "src/absent.ts",
    search: {
      unique: "uniqueToken",
      absent: "nothingMatchesThis",
      flood: { query: "floodToken", totalMatches: FLOOD_FILES },
      repeated: { query: "repeatedToken", snippets: 3 },
    },
  };
}

runClientConformance("local-checkout", openCase);
