import { db, findModelKeySummary } from "@pr-review/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell";
import { formatRelative } from "@/lib/format";
import { MODEL_KEY_PROVIDERS, providerLabel } from "@/lib/model-key";
import { requireOrganization } from "@/lib/session";

import { ModelKeyForm } from "./model-key-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { organization, role } = await requireOrganization(slug);
  // Members get the same 404 as a stranger: the page's existence is owner business.
  if (role !== "owner") notFound();
  const summary = await findModelKeySummary(db(), organization.id);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Model key"
        description="Reviews run on your organization's own model provider key. Once it is saved, add the ai-review label to a pull request on an installed repository and LintCat reviews it with this key."
      />
      <div className="mt-8 max-w-2xl">
        <ModelKeyForm
          slug={organization.slug}
          providers={Object.entries(MODEL_KEY_PROVIDERS).map(([value, label]) => ({
            value,
            label,
          }))}
          current={
            summary && {
              provider: summary.provider,
              providerLabel: providerLabel(summary.provider),
              last4: summary.last4,
              updated: formatRelative(summary.updatedAt),
            }
          }
        />
      </div>
    </>
  );
}
