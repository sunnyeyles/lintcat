import { db, effectiveRepoSettings, findModelKeySummary } from "@pr-review/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shell";
import { RepoName } from "@/components/ui";
import { toOptions } from "@/lib/forms";
import { MODEL_KEY_PROVIDERS, type ModelKeyProvider } from "@/lib/model-key";
import { DEFAULT_MODEL_VALUE, REPO_REVIEW_MODES, repoModelOptions } from "@/lib/repo-settings";
import { requireRepo } from "@/lib/session";

import { RepoSettingsForm } from "./repo-settings-form";

export const metadata: Metadata = { title: "Repository settings" };

function isProvider(value: string | undefined): value is ModelKeyProvider {
  return value !== undefined && value in MODEL_KEY_PROVIDERS;
}

export default async function RepoSettingsPage({
  params,
}: {
  params: Promise<{ slug: string; owner: string; name: string }>;
}) {
  const { slug, owner, name } = await params;
  const { organization, repo } = await requireRepo(slug, owner, name);
  const [settings, key] = await Promise.all([
    effectiveRepoSettings(db(), repo.id),
    findModelKeySummary(db(), organization.id),
  ]);
  const provider = isProvider(key?.provider) ? key.provider : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Repository settings"
        title={
          <RepoName owner={repo.owner} name={repo.name} className="font-mono text-[0.85em]" />
        }
        description={
          provider
            ? `Hosted reviews run on the organization's ${MODEL_KEY_PROVIDERS[provider]} key.`
            : "The organization has no model key yet, so hosted reviews cannot run until an owner adds one."
        }
      />
      <div className="mt-8 max-w-2xl">
        <RepoSettingsForm
          slug={organization.slug}
          owner={repo.owner}
          name={repo.name}
          isOwner={repo.isOwner}
          modes={toOptions(REPO_REVIEW_MODES)}
          models={repoModelOptions(provider, settings.model)}
          current={{
            mode: settings.mode,
            model: settings.model ?? DEFAULT_MODEL_VALUE,
            fixes: settings.fixes,
          }}
        />
      </div>
    </>
  );
}
