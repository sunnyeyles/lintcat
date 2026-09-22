import { Button, cn, Separator } from "@pr-review/design";
import Link from "next/link";

import { LogoMark } from "@/components/shell/logo-mark";
import { DOCS_HOME } from "@/lib/docs";
import { INSTALL_APP_URL } from "@/lib/github-app";
import { appDomain } from "@/lib/host";
import { apexUrl, DASHBOARD_PATH } from "@/lib/paths";
import { requestLocation } from "@/lib/request";

/** The footer's chrome, with no request-bound data, so a static page can render it. */
export function SiteFooterFrame({
  className,
  docsHref = DOCS_HOME,
  dashboardHref = DASHBOARD_PATH,
}: {
  className?: string;
  docsHref?: string;
  dashboardHref?: string;
}) {
  return (
    <footer className={cn("bg-background", className)}>
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4 sm:px-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LogoMark variant="mono" className="size-5" />
          <span>© {new Date().getFullYear()} LintCat</span>
        </div>
        <nav aria-label="Footer" className="-mx-3 flex flex-wrap items-center">
          <Button asChild variant="link" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
            <Link href={docsHref}>Docs</Link>
          </Button>
          <Button asChild variant="link" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
            <Link href={dashboardHref}>Dashboard</Link>
          </Button>
          <Button asChild variant="link" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
            <a href={INSTALL_APP_URL} target="_blank" rel="noreferrer">
              GitHub App
            </a>
          </Button>
        </nav>
      </div>
    </footer>
  );
}

// Organization pages live on subdomains, so the links point back at the apex.
export async function SiteFooter({ className }: { className?: string }) {
  const { host, protocol } = await requestLocation();
  const domain = appDomain();
  return (
    <SiteFooterFrame
      className={className}
      docsHref={apexUrl(DOCS_HOME, host, protocol, domain)}
      dashboardHref={apexUrl(DASHBOARD_PATH, host, protocol, domain)}
    />
  );
}
