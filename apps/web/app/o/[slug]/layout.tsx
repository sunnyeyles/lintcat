import type { ReactNode } from "react";

import { MainColumn } from "@/components/shell/main-column";
import { Sidebar } from "@/components/shell/sidebar";
import { SiteFooter } from "@/components/shell/site-footer";
import { Topbar } from "@/components/shell/topbar";
import { appDomain } from "@/lib/host";
import { apexUrl } from "@/lib/paths";
import { requestLocation } from "@/lib/request";
import { RUN_TRACE_PATH } from "@/lib/run-trace-page";
import { requireOrganization } from "@/lib/session";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { organization, role } = await requireOrganization((await params).slug);
  const isOwner = role === "owner";
  const { host, protocol } = await requestLocation();
  const runTrace = apexUrl(RUN_TRACE_PATH, host, protocol, appDomain());
  return (
    <div className="flex min-h-dvh flex-col">
      <Topbar isOwner={isOwner} />
      <div className="flex flex-1">
        <Sidebar slug={organization.slug} organizationName={organization.name} isOwner={isOwner} runTraceHref={runTrace} />
        <MainColumn>{children}</MainColumn>
      </div>
      <SiteFooter />
    </div>
  );
}
