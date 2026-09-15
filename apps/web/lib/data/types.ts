import type { Finding, Repo, Review, Team } from "@pr-review/db";

export type Severity = "low" | "medium" | "high";

export const AGENTS = [
  "security",
  "correctness",
  "performance",
  "test-coverage",
  "docs-drift",
] as const;

export type AgentName = (typeof AGENTS)[number];

export type TokenCounts = {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
};

export type AgentRun = TokenCounts & {
  id: number;
  reviewId: number;
  agent: AgentName;
  durationMs: number;
  findingCount: number;
};

// `agents` narrows Drizzle's text[] to the names the UI can actually render.
export type ReviewSummary = Omit<Review, "agents"> &
  TokenCounts & {
    agents: AgentName[];
    repo: Repo;
    findingCount: number;
    bySeverity: Record<Severity, number>;
    durationMs: number;
    costUsd: number;
  };

export type ReviewDetail = ReviewSummary & {
  findings: Finding[];
  runs: AgentRun[];
};

export type RepoSummary = Repo & {
  reviewCount: number;
  findingCount: number;
  openHighSeverity: number;
  lastReviewedAt: Date | null;
  costUsd: number;
};

export type TrendPoint = {
  date: string;
  reviews: number;
  low: number;
  medium: number;
  high: number;
};

export type AgentBreakdown = TokenCounts & {
  agent: AgentName;
  findingCount: number;
  reviewCount: number;
  medianDurationMs: number;
  costUsd: number;
};

export type CategoryCount = {
  category: string;
  count: number;
  bySeverity: Record<Severity, number>;
};

export type Trends = {
  points: TrendPoint[];
  byAgent: AgentBreakdown[];
  byCategory: CategoryCount[];
  totals: {
    reviews: number;
    findings: number;
    bySeverity: Record<Severity, number>;
    medianDurationMs: number;
  };
};

export type UsagePoint = TokenCounts & {
  date: string;
  costUsd: number;
};

export type Usage = {
  points: UsagePoint[];
  byAgent: AgentBreakdown[];
  byRepo: Array<{ repo: Repo; costUsd: number; reviewCount: number } & TokenCounts>;
  totals: TokenCounts & { costUsd: number; reviewCount: number };
};

export type AgentConfig = {
  agents: AgentName[];
  fix: boolean;
  memoryBranch: string | null;
  paths: { include: string[]; exclude: string[] };
};

export type Range = "7d" | "30d" | "90d";

export type DataSource = {
  isDemo: boolean;
  team: Team;
  listRepos(): Promise<RepoSummary[]>;
  getRepo(owner: string, name: string): Promise<RepoSummary | null>;
  listReviews(opts?: { repoId?: number; limit?: number }): Promise<ReviewSummary[]>;
  getReview(id: number): Promise<ReviewDetail | null>;
  getTrends(range: Range, repoId?: number): Promise<Trends>;
  getUsage(range: Range, repoId?: number): Promise<Usage>;
  getAgentConfig(repoId: number): Promise<AgentConfig>;
};
