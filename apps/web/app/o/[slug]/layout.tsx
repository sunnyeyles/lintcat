import type { ReactNode } from "react";

import { MainColumn } from "@/components/shell/main-column";
import { Sidebar } from "@/components/shell/sidebar";
import { requireOrganization } from "@/lib/session";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { organization } = await requireOrganization((await params).slug);
  return (
    <div className="flex">
      <Sidebar slug={organization.slug} organizationName={organization.name} />
      <MainColumn>{children}</MainColumn>
    </div>
  );
}
