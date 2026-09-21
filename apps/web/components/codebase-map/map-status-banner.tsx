import { Alert, AlertDescription, AlertTitle, Badge } from "@pr-review/design";
import { CircleCheck, CircleSlash, Info, TriangleAlert } from "lucide-react";

import type { MapStatus } from "@/lib/codebase-map";

const HEADINGS: Record<MapStatus["kind"], string> = {
  empty: "Nothing to map",
  "no-changes": "No files changed",
  partial: "Partial data",
  ready: "Map ready",
};

const ICONS = {
  empty: CircleSlash,
  "no-changes": CircleCheck,
  partial: TriangleAlert,
  ready: Info,
} as const;

export function MapStatusBanner({ status }: { status: MapStatus }) {
  const Icon = ICONS[status.kind];
  return (
    <Alert data-status={status.kind}>
      <Icon />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {HEADINGS[status.kind]}
        <Badge variant={status.kind === "partial" ? "attention" : "secondary"}>
          {status.kind}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <p>
          {status.totalFileCount > status.fileCount
            ? `${status.fileCount} of ${status.totalFileCount} files loaded`
            : `${status.fileCount} file${status.fileCount === 1 ? "" : "s"}`}{" "}
          · {status.changedCount} changed
          · change data on {status.flagCoverage.changed}, dead on {status.flagCoverage.dead}, cycle
          on {status.flagCoverage.inCycle}
        </p>
        {status.reasons.length > 0 ? (
          <ul className="mt-1 list-disc pl-4">
            {status.reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
          </ul>
        ) : status.kind === "no-changes" ? (
          <p>Every file carries a change flag and none of them is set.</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
