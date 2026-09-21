import { Badge, Button } from "@pr-review/design";
import Link from "next/link";
import type { ReactNode } from "react";

import { MainColumn } from "@/components/shell/main-column";
import { Sidebar } from "@/components/shell/sidebar";
import { TopbarFrame } from "@/components/shell/topbar-frame";
import { DOCS_HOME } from "@/lib/docs";
import { DASHBOARD_PATH } from "@/lib/paths";

// UI review pages on sample data: the dashboard shell without a session or database.
export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <TopbarFrame
        docsHref={DOCS_HOME}
        right={
          <>
            <Badge variant="secondary">Preview · sample data</Badge>
            <Button asChild variant="outline" size="sm">
              <Link href={DASHBOARD_PATH}>Dashboard</Link>
            </Button>
          </>
        }
      />
      <div className="flex">
        <Sidebar slug="funnelweb" organizationName="Funnelweb" />
        <MainColumn>{children}</MainColumn>
      </div>
    </div>
  );
}
