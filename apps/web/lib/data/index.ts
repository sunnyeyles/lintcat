import { createMockSource } from "./mock";
import type { DataSource } from "./types";

// The only place that decides where dashboard data comes from.
let source: DataSource | null = null;

export function data(): DataSource {
  if (!source) source = createMockSource();
  return source;
}

export * from "./types";
export { costOf } from "./mock";
