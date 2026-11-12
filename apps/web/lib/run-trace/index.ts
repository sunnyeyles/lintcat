// Browser-safe: the node-only loader is imported from `@/lib/run-trace/load-run-dir`.
export { ADAPTERS, detectFormat, findAdapter, FORMAT_IDS, parseTrace } from "@/lib/run-trace/adapters/registry";
export type { RunFile } from "@/lib/run-trace/adapters/types";
