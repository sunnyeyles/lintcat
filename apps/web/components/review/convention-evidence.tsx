import type { FindingEvidence } from "@pr-review/schemas";

import { blobUrl, type CommitRef } from "@/lib/github-links";

export type ConventionEvidenceProps = {
  evidence: readonly FindingEvidence[];
  source: CommitRef;
};

export function ConventionEvidence({ evidence, source }: ConventionEvidenceProps) {
  return (
    <ul className="flex flex-col gap-1.5">
      {evidence.map((entry) => (
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
      ))}
    </ul>
  );
}
