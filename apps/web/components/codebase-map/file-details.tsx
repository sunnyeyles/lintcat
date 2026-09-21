"use client";

import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Tooltip, TooltipContent, TooltipTrigger } from "@pr-review/design";

import { neighbourhood } from "@/lib/codebase-map";
import type { NormalisedGraph } from "@/lib/codebase-map";

const SHOWN = 12;

export interface FileDetailsProps {
  graph: NormalisedGraph;
  focusedPath: string | null;
  groupId: string | null;
  groupCollapsed: boolean;
  onSelect: (path: string) => void;
  onToggleGroup: () => void;
}

function FlagRow({
  label,
  value,
  flagged,
  clear,
}: {
  label: string;
  value: boolean | undefined;
  flagged: string;
  clear: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      {value === true ? (
        <Badge variant="attention">{flagged}</Badge>
      ) : value === false ? (
        <Badge variant="outline">{clear}</Badge>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" tabIndex={0}>
              Unknown
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Nothing measured this. It is not a claim of absence.</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function PathList({
  title,
  paths,
  onSelect,
}: {
  title: string;
  paths: readonly string[];
  onSelect: (path: string) => void;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold">
        {title} <span className="text-muted-foreground font-normal">({paths.length})</span>
      </h4>
      {paths.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-xs">None in this map.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {paths.slice(0, SHOWN).map((path) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => onSelect(path)}
                className="focus-visible:ring-ring hover:bg-accent w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                {path}
              </button>
            </li>
          ))}
          {paths.length > SHOWN ? (
            <li className="text-muted-foreground px-1.5 text-xs">
              and {paths.length - SHOWN} more
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

export function FileDetails({
  graph,
  focusedPath,
  groupId,
  groupCollapsed,
  onSelect,
  onToggleGroup,
}: FileDetailsProps) {
  const file = focusedPath === null ? undefined : graph.byPath.get(focusedPath);
  if (!file) {
    return (
      <Empty className="border-border rounded-lg border border-dashed py-8">
        <EmptyHeader>
          <EmptyTitle className="text-sm">No file focused</EmptyTitle>
          <EmptyDescription className="text-xs">
            Click a file, search for one, or press an arrow key on the map.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const hood = neighbourhood(graph, file.path, 1);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold tracking-wide uppercase">Focused file</h3>
        <p className="mt-1 font-mono text-sm break-all">{file.path}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {file.package ?? "no package"}
          {file.role ? ` · ${file.role}` : ""}
        </p>
      </div>

      <div className="space-y-1.5">
        <FlagRow label="Changed in this PR" value={file.changed} flagged="Changed" clear="Unchanged" />
        <FlagRow label="Dead file" value={file.dead} flagged="Dead" clear="Reachable" />
        <FlagRow label="Import cycle" value={file.inCycle} flagged="In a cycle" clear="No cycle" />
      </div>

      {groupId ? (
        <Button variant="outline" size="sm" className="w-full" onClick={onToggleGroup}>
          {groupCollapsed ? "Expand this group" : "Collapse this group"}
        </Button>
      ) : null}

      <PathList title="Depends on" paths={[...hood.dependencies.keys()]} onSelect={onSelect} />
      <PathList title="Depended on by" paths={[...hood.dependents.keys()]} onSelect={onSelect} />
    </div>
  );
}
