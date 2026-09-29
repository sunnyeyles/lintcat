import type { ReactNode } from "react";

import { SectionHeading } from "@/components/ui";

export const FINDINGS_ANCHOR = "findings-heading";

export function FindingsSection({ action, children }: { action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={FINDINGS_ANCHOR} className="flex flex-col gap-4">
      <SectionHeading id={FINDINGS_ANCHOR} title="Findings" action={action} className="items-end" />
      {children}
    </section>
  );
}
