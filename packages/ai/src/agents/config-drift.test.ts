import { buildRepositoryIndex } from "@pr-review/index";
import { describe, expect, it } from "vitest";

import { renderConfigDrift } from "#src/agents/config-drift";

const index = buildRepositoryIndex({
  sha: "0".repeat(40),
  files: new Map([
    [".env.example", "QUEUE_URL=\nMAX_RETRIES=5\n"],
    ["package.json", '{\n  "dependencies": {\n    "date-fns": "^4.1.0"\n  }\n}\n'],
    ["src/a.ts", 'import { format } from "date-fns";\n'],
    ["src/b.ts", 'import { addDays } from "date-fns";\n'],
  ]),
});

const changedFiles = [
  {
    filename: "src/signing.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const secret = process.env.SIGNING_SECRET;",
  },
  {
    filename: "package.json",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: '@@ -3,0 +4 @@\n+    "dayjs": "^1.11.13",',
  },
];

describe("renderConfigDrift", () => {
  it("states each fact with the line to anchor on and the lines to cite", () => {
    expect(renderConfigDrift(index, { changedFiles })).toEqual([
      "<config_drift>",
      expect.stringContaining('"config" drift'),
      "- src/signing.ts:1 reads SIGNING_SECRET, which no env example or doc in this repository names; the others are documented at .env.example:1, .env.example:2",
      "- package.json:4 adds dayjs for dates, a job date-fns already does here: src/a.ts:1, src/b.ts:1",
      "</config_drift>",
      "",
    ]);
  });

  it("is absent without an index or a fact", () => {
    expect(renderConfigDrift(undefined, { changedFiles })).toEqual([]);
    expect(renderConfigDrift(index, { changedFiles: [] })).toEqual([]);
  });
});
