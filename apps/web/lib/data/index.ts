import { createMockSource } from "./mock";
import type { DataSource } from "./types";

let demo: DataSource | null = null;

// Analytics, Usage and Agents still read this fixture; the rest use data() in ./server.
export function demoData(): DataSource {
  if (!demo) demo = createMockSource();
  return demo;
}

export * from "./types";
export { costOf, isAgentName } from "./aggregate";
export { agentForCategory } from "./mock";
