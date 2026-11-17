import { Button } from "@pr-review/design";
import Link from "next/link";

import { SidebarDrawer } from "@/components/shell/sidebar";
import { TopbarFrame } from "@/components/shell/topbar-frame";
import { UserMenu } from "@/components/shell/user-menu";
import { DOCS_HOME } from "@/lib/docs";
import { appDomain } from "@/lib/host";
import { apexUrl, DASHBOARD_PATH, topbarSignInHref } from "@/lib/paths";
import { requestLocation } from "@/lib/request";

export async function Topbar({ isOwner = false, className }: { isOwner?: boolean; className?: string }) {
  const { host, protocol, path } = await requestLocation();
  const domain = appDomain();
  const signInHref = topbarSignInHref(path, domain);
  const home = apexUrl("/", host, protocol, domain);
  const docs = apexUrl(DOCS_HOME, host, protocol, domain);
  const dashboard = apexUrl(DASHBOARD_PATH, host, protocol, domain);

  return (
    <TopbarFrame
      className={className}
      homeHref={home}
      docsHref={docs}
      left={<SidebarDrawer isOwner={isOwner} />}
      right={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={dashboard}>Dashboard</Link>
          </Button>
          <UserMenu signInHref={signInHref} />
        </>
      }
    />
  );
}
