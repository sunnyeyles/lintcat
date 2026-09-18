import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderTokensCss } from "#src/tokens";

const generated = [
  new URL("./tokens.css", import.meta.url),
  new URL("../../../docs/tokens.css", import.meta.url),
];

describe("tokens.css", () => {
  it.each(generated.map((url) => [fileURLToPath(url)]))("%s matches tokens.ts", (path) => {
    expect(readFileSync(path, "utf8")).toBe(renderTokensCss());
  });
});
