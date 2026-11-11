export { createFactoryService, type FactoryService } from "#src/service";
export { runDiscovery, type DiscoveryIO, type DiscoveryTurn, type ReviewDecision } from "#src/discovery";
export { PROFILE_NAMES, type ProfileName, type Spec, type TaskContract } from "#src/contract";
export { openFactoryDatabase, migrateFactoryDatabase } from "#src/store/client";
export type { FactoryRun, FactoryEvent, FactoryCommand } from "#src/store/schema";
export { createDockerProvider, dockerAvailable, buildSandboxImage } from "#src/sandbox/docker-sandbox";
export { detectChecks } from "#src/checks";
export { ensureFactoryExcluded, repoRoot } from "#src/git";
export { renderTaskMarkdown } from "#src/run-files";
export { TOOL_VERSION } from "#src/telemetry";
export { specSchema } from "#src/contract";
export {
  continueDiscovery,
  loadDiscoverySession,
  startDiscovery,
  type DiscoveryReply,
  type DiscoverySession,
} from "#src/discovery";
export { analyseRepository, renderArchitecture, type ArchitectureBrief } from "#src/repository";
export { profileMetrics, type ProfileMetrics } from "#src/metrics";
export { learningReport, type FailureCluster, type LearningReport } from "#src/learning";
export { listLessons, pruneRunHistory } from "#src/store/index";
export type { FactoryLesson } from "#src/store/schema";
export { loadBenchConfig } from "#src/bench/config";
export { listFixtures } from "#src/bench/fixtures";
export { loadResults, resultDirName, runBenchmark, type BenchResult } from "#src/bench/runner";
export { renderComparison } from "#src/bench/compare";
