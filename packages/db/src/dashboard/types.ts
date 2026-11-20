
import type {
  Finding,
  Organization,
  Repo,
  Review,
  WorkflowJob,
  WorkflowRun,
} from "../schema";

export type Severity = "low" | "medium" | "high";

export type TokenCounts = {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
};

export type ReviewSummary = Review &
  TokenCounts & {
    repo: Repo;
    findingCount: number;
    bySeverity: Record<Severity, number>;
    costUsd: number;
  };

export type ReviewDetail = ReviewSummary & {
  findings: Finding[];
};

/** Just enough to link to a review. */
export type ReviewLink = Pick<Review, "id" | "prNumber"> & { repo: Pick<Repo, "owner" | "name"> };

export type ReviewStat = TokenCounts &
  Pick<Review, "id" | "repoId" | "createdAt" | "durationMs"> & {
    bySeverity: Record<Severity, number>;
    costUsd: number;
  };

export type RepoSummary = Repo & {
  reviewCount: number;
  findingCount: number;
  highSeverity: number;
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

export type CategoryCount = {
  category: string;
  count: number;
  bySeverity: Record<Severity, number>;
};

export type Trends = {
  points: TrendPoint[];
  byCategory: CategoryCount[];
  totals: {
    reviews: number;
    findings: number;
    bySeverity: Record<Severity, number>;
    medianDurationMs: number;
    costUsd: number;
  };
};

export type UsagePoint = TokenCounts & {
  date: string;
  costUsd: number;
};

export type Usage = {
  points: UsagePoint[];
  byRepo: Array<{ repo: Repo; costUsd: number; reviewCount: number } & TokenCounts>;
  totals: TokenCounts & { costUsd: number; reviewCount: number };
};

export type Range = "7d" | "30d" | "90d";

export type ReviewListOptions = {
  repoId?: number;
  repo?: { owner: string; name: string };
  // Keeps reviews with at least one finding this severe or worse.
  minSeverity?: Severity;
  hasFindings?: boolean;
  limit?: number;
};

// Null until the run completes.
export type WorkflowRunSummary = WorkflowRun & { durationMs: number | null };

export type WorkflowRunDetail = WorkflowRunSummary & {
  repo: Repo;
  jobs: WorkflowJob[];
};

// "failure" also matches timed_out and startup_failure, as the failure rate counts them.
export type CiConclusionFilter = "success" | "failure" | "cancelled";

export type WorkflowRunListOptions = {
  repoId: number;
  branch?: string;
  workflowId?: number;
  conclusion?: CiConclusionFilter;
  limit?: number;
};

export type WorkflowTrend = {
  workflowId: number;
  workflowName: string;
  runs: number;
  failures: number;
  // Null when no run has a success-or-failure verdict yet.
  failureRate: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  lastStatus: string;
  lastConclusion: string | null;
  lastRunAt: Date;
};

export type CiTrends = {
  workflows: WorkflowTrend[];
  totals: {
    runs: number;
    failures: number;
    failureRate: number | null;
    medianDurationMs: number | null;
    slowestWorkflow: { workflowId: number; workflowName: string; p50DurationMs: number } | null;
  };
};

export type DataSource = {
  organization: Organization;
  listRepos(): Promise<RepoSummary[]>;
  getRepo(owner: string, name: string): Promise<RepoSummary | null>;
  listReviews(opts?: ReviewListOptions): Promise<ReviewSummary[]>;
  getReview(id: number): Promise<ReviewDetail | null>;
  /** The reviews either side of this one in its repo's history. */
  getAdjacentReviews(id: number): Promise<{ newer: ReviewLink | null; older: ReviewLink | null }>;
  /** The access check a map runs before any cache read; null when the review is unreadable. */
  getMapAccess(id: number): Promise<{ repoId: number; baseSha: string | null } | null>;
  getTrends(range: Range, repoId?: number): Promise<Trends>;
  getUsage(range: Range, repoId?: number): Promise<Usage>;
  listWorkflowRuns(opts: WorkflowRunListOptions): Promise<WorkflowRunSummary[]>;
  getWorkflowRun(id: number): Promise<WorkflowRunDetail | null>;
  /** Every workflow's last 30 days of runs in the repo. */
  getCiTrends(repoId: number): Promise<CiTrends>;
};
