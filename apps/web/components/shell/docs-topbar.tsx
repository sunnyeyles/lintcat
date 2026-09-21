import { Button } from "@pr-review/design";
import Link from "next/link";

import { ThemeToggle } from "@/components/shell/theme-toggle";
import { TopbarFrame } from "@/components/shell/topbar-frame";
import { DOCS_HOME } from "@/lib/docs";
import { appDomain } from "@/lib/host";
import { DASHBOARD_PATH, signInUrl } from "@/lib/paths";

// Docs are apex-only, so every link is relative and no session is read: the page stays static.
export function DocsTopbar({ className }: { className?: string }) {
  return (
    <TopbarFrame
      className={className}
      docsHref={DOCS_HOME}
      right={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={DASHBOARD_PATH}>Dashboard</Link>
          </Button>
          <ThemeToggle />
          <Button asChild size="sm">
            <Link href={signInUrl(DASHBOARD_PATH, appDomain())}>Sign in</Link>
          </Button>
        </>
      }
    />
  );
}
