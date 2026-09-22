// Bundles then runs the worker, so `pnpm start` never runs stale code. Extra args pass through.
import { bundleAndRun } from "../../scripts/lib/bundle.mjs";

await bundleAndRun(import.meta.url);
