import type { Finding, Organization, Repo, Review } from "../schema";

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

export type DataSource = {
  organization: Organization;
  listRepos(): Promise<RepoSummary[]>;
  getRepo(owner: string, name: string): Promise<RepoSummary | null>;
  listReviews(opts?: { repoId?: number; limit?: number }): Promise<ReviewSummary[]>;
  getReview(id: number): Promise<ReviewDetail | null>;
  getTrends(range: Range, repoId?: number): Promise<Trends>;
  getUsage(range: Range, repoId?: number): Promise<Usage>;
};
