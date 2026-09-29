import { blobUrl, type CommitRef } from "@pr-review/github/links";
import { evidenceLabel, isConventionCount, type FindingEvidence } from "@pr-review/schemas";

export type ConventionEvidenceProps = {
  evidence: readonly FindingEvidence[];
  source: CommitRef;
};

export function ConventionEvidence({ evidence, source }: ConventionEvidenceProps) {
  return (
    <ul className="flex flex-col gap-1.5">
      {evidence.map((entry) =>
        isConventionCount(entry) ? (
          <li key={`${entry.convention}@${entry.file}`} className="text-sm text-foreground">
            {evidenceLabel(entry)}
          </li>
        ) : (
          <li key={`${entry.file}:${entry.line}`}>
            <a
              href={blobUrl(source, entry.file, entry.line)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm break-all text-link underline underline-offset-2 hover:no-underline"
            >
              {entry.file}:{entry.line}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
