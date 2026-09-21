"use client";

import { Badge } from "@pr-review/design";

import type { Clustering } from "@/lib/codebase-map";

const SHOWN = 12;

export interface GroupListProps {
  clustering: Clustering;
  onToggle: (groupId: string) => void;
}

export function GroupList({ clustering, onToggle }: GroupListProps) {
  const groups = [...clustering.groups]
    .sort((a, b) => b.files.length - a.files.length)
    .slice(0, SHOWN);

  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide uppercase">
        Groups <span className="text-muted-foreground font-normal">({clustering.groups.length})</span>
      </h3>
      <ul className="mt-2 space-y-1">
        {groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              aria-expanded={!group.collapsed}
              onClick={() => onToggle(group.id)}
              className="focus-visible:ring-ring hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{group.directory}</span>
              {group.changedCount > 0 ? (
                <Badge variant="attention" className="shrink-0">
                  {group.changedCount}
                </Badge>
              ) : null}
              <Badge variant="outline" className="shrink-0">
                {group.collapsed ? "collapsed" : "expanded"}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
