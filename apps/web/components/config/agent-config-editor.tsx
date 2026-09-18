"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button, Label, Separator, Switch } from "@/components/ui";
import {
  AGENT_CONFIG_PATH,
  pathPatterns,
  toWorkflowYaml,
  toYaml,
} from "@/lib/agent-config";
import type { AgentConfig } from "@/lib/data/types";

import { AgentOrderList } from "./agent-order-list";
import { GlobList } from "./glob-list";
import { YamlPreview } from "./yaml-preview";

export type AgentConfigEditorProps = {
  loaded: AgentConfig;
  repoLabel: string;
};

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 font-mono text-[0.68rem] leading-relaxed text-warn">
      <TriangleAlert aria-hidden className="mt-px size-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function AgentConfigEditor({ loaded, repoLabel }: AgentConfigEditorProps) {
  const [config, setConfig] = useState<AgentConfig>(loaded);

  const agentYaml = useMemo(() => toYaml(config), [config]);
  const workflowYaml = useMemo(() => toWorkflowYaml(config), [config]);
  const patternCount = pathPatterns(config.paths).length;
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(loaded),
    [config, loaded],
  );

  const summary = `${AGENT_CONFIG_PATH} updated: ${config.agents.length} agents, ${patternCount} path patterns.`;

  function patch(next: Partial<AgentConfig>) {
    setConfig((current) => ({ ...current, ...next }));
  }

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-8">
      <form
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => event.preventDefault()}
      >
        <AgentOrderList
          agents={config.agents}
          onChange={(agents) => patch({ agents })}
        />

        <Separator />

        <div className="min-w-0">
          <p className="eyebrow">Behaviour</p>

          <div className="mt-3 flex flex-col gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <Switch
                  id="config-fix"
                  checked={config.fix}
                  onCheckedChange={(fix) => patch({ fix })}
                />
                <Label htmlFor="config-fix">Commit verified fixes</Label>
              </div>
              <Warning>
                Commits to the pull request branch. Needs <code>contents: write</code>.
                Left off, fixes are offered as suggested changes instead.
              </Warning>
            </div>

            <div className="min-w-0 sm:max-w-[24rem]">
              <Label htmlFor="config-memory-branch">Memory branch</Label>
              <input
                id="config-memory-branch"
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="pr-review-memory"
                value={config.memoryBranch ?? ""}
                onChange={(event) =>
                  patch({
                    memoryBranch: event.target.value === "" ? null : event.target.value,
                  })
                }
                className="mt-1.5 h-8 w-full rounded-[3px] border border-rule bg-surface px-2 font-mono text-[0.72rem] text-ink transition-colors outline-none placeholder:text-slate-dim hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              />
              <Warning>
                Stores review memory on this branch. Needs <code>contents: write</code>{" "}
                and <code>closed</code> in the workflow&rsquo;s <code>types</code>. Empty
                leaves the feature off.
              </Warning>
            </div>
          </div>
        </div>

        <Separator />

        <div className="min-w-0">
          <p className="eyebrow">Path gate</p>
          <p className="mt-1.5 font-mono text-[0.7rem] leading-relaxed text-slate">
            A gate, not a narrowing: one matching file wakes the agent, which then
            reviews the whole pull request. Patterns are repository-relative.
          </p>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <GlobList
              legend="Include"
              noun="include pattern"
              hint="Files that wake the agents, e.g. packages/github/**"
              placeholder="src/**"
              values={config.paths.include}
              onChange={(include) => patch({ paths: { ...config.paths, include } })}
            />
            <GlobList
              legend="Exclude"
              noun="exclude pattern"
              hint="Subtracted from the above, written as ! negations."
              placeholder="**/*.test.ts"
              values={config.paths.exclude}
              onChange={(exclude) => patch({ paths: { ...config.paths, exclude } })}
            />
          </div>

          {config.paths.include.length === 0 && config.paths.exclude.length > 0 ? (
            <Warning>
              Nothing but exclusions matches no file, and the action rejects it at
              config-parse time. Add an include pattern.
            </Warning>
          ) : null}
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty}
            onClick={() => setConfig(loaded)}
          >
            <RotateCcw aria-hidden />
            Reset to loaded config
          </Button>
          <span className="font-mono text-[0.68rem] text-slate-dim">
            {dirty
              ? "Edited here only. Copy the YAML to keep these changes."
              : `Matches the configuration loaded for ${repoLabel}.`}
          </span>
        </div>
      </form>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <YamlPreview
          filename={AGENT_CONFIG_PATH}
          caption="Commit this to your default branch."
          yaml={agentYaml}
          summary={summary}
        />
        {workflowYaml !== "" ? (
          <YamlPreview
            filename="Workflow inputs"
            caption="fix and memory-branch are action inputs, not keys of the file above."
            yaml={workflowYaml}
            summary=""
          />
        ) : null}
      </div>
    </div>
  );
}
