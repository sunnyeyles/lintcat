#!/usr/bin/env node
// Rebuilds (about 150ms) before every run, so a hook never reviews with stale code.
import { bundleAndRun } from "../../scripts/lib/bundle.mjs";

await bundleAndRun(import.meta.url);
