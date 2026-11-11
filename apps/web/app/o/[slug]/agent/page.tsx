import { db, findModelKeySummary } from "@pr-review/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shell";
import { TelemetryAgent } from "@/components/telemetry-agent/telemetry-agent";
import { organizationPath } from "@/lib/paths";
import { requireOrganization } from "@/lib/session";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { organization, role } = await requireOrganization(slug);
  const key = await findModelKeySummary(db(), organization.id);

  return (
    <>
      <PageHeader
        eyebrow="Agent"
        title="Telemetry agent"
        description="Ask questions about this organization's reviews, findings, tokens and cost. Runs on the organization's model key."
      />
      <TelemetryAgent
        slug={organization.slug}
        endpoint={`/api/telemetry-agent/${encodeURIComponent(organization.slug)}`}
        noModelKey={
          key
            ? undefined
            : { settingsHref: role === "owner" ? organizationPath(organization.slug, "/settings") : undefined }
        }
      />
    </>
  );
}
