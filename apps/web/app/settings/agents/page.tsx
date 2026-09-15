import { AgentConfigEditor, RepoPicker } from "@/components/config";
import { PageHeader } from "@/components/shell";
import { EmptyState } from "@/components/ui";
import { AGENT_CONFIG_PATH } from "@/lib/agent-config";
import { data } from "@/lib/data";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AgentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, repos] = await Promise.all([searchParams, data().listRepos()]);

  if (repos.length === 0) {
    return (
      <>
        <PageHeader eyebrow="CONFIGURATION" title="Agents" />
        <div className="mt-8">
          <EmptyState
            title="No repositories yet"
            description="Connect a repository and its agent configuration will be editable here."
          />
        </div>
      </>
    );
  }

  const requested = Number(firstValue(params["repo"]));
  const selected = repos.find((repo) => repo.id === requested) ?? repos[0];
  if (selected === undefined) return null;

  const config = await data().getAgentConfig(selected.id);
  const repoLabel = `${selected.owner}/${selected.name}`;

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Agents"
        description={
          <>
            Builds <code>{AGENT_CONFIG_PATH}</code> for {repoLabel}. This dashboard has
            no GitHub credentials, so nothing here is written to the repository — copy
            the YAML and commit it yourself.
          </>
        }
      />

      <div className="mt-6">
        <RepoPicker repos={repos} selectedId={selected.id} />
      </div>

      <div className="mt-8">
        <AgentConfigEditor key={selected.id} loaded={config} repoLabel={repoLabel} />
      </div>
    </>
  );
}
