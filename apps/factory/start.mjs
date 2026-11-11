#!/usr/bin/env node
import { bundleAndRun } from "../../scripts/lib/bundle.mjs";

await bundleAndRun(import.meta.url);
