// Rebuilds (about 150ms) before every start, so a client never runs stale code.
import { bundleAndRun } from "../../scripts/lib/bundle.mjs";

await bundleAndRun(import.meta.url);
