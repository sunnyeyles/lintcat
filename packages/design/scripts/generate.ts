import { writeFileSync } from "node:fs";

import { renderTokensCss } from "#src/tokens";

const TARGETS = [
  new URL("../src/tokens.css", import.meta.url),
  new URL("../../../docs/tokens.css", import.meta.url),
];

const css = renderTokensCss();
for (const target of TARGETS) writeFileSync(target, css);
