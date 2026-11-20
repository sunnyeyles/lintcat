import { Badge, cn } from "@pr-review/design";

export type ConclusionBadgeProps = {
  status: string;
  conclusion: string | null;
  className?: string;
};

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

export function conclusionTone(status: string, conclusion: string | null) {
  if (status !== "completed") return "running" as const;
  if (conclusion === "success") return "success" as const;
  if (conclusion !== null && FAILED.has(conclusion)) return "failure" as const;
  return "neutral" as const;
}

const TONE = {
  success: "border-success/40 bg-success/15 text-success",
  failure: "border-destructive/40 bg-destructive/15 text-destructive",
  running: "text-foreground",
  neutral: "text-muted-foreground",
} as const;

export function ConclusionBadge({ status, conclusion, className }: ConclusionBadgeProps) {
  const label = status === "completed" ? (conclusion ?? "completed") : status;
  return (
    <Badge variant="outline" className={cn(TONE[conclusionTone(status, conclusion)], className)}>
      {label.replace(/_/g, " ")}
    </Badge>
  );
}
