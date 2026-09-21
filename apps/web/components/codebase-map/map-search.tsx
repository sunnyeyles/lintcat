"use client";

import { Badge, Input } from "@pr-review/design";
import { useId, type RefObject } from "react";

import { searchFiles } from "@/lib/codebase-map";
import type { MapFile } from "@/lib/codebase-map";

const SHOWN = 12;

export interface MapSearchProps {
  files: readonly MapFile[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (path: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

const KIND_LABEL = {
  "name-prefix": "name",
  segment: "folder",
  substring: "text",
} as const;

export function MapSearch({
  files,
  query,
  onQueryChange,
  onSelect,
  inputRef,
}: MapSearchProps) {
  const listId = useId();
  const all = searchFiles(files, query);
  const shown = all.slice(0, SHOWN);

  return (
    <div>
      <label htmlFor={`${listId}-input`} className="text-xs font-semibold tracking-wide uppercase">
        Find a file
      </label>
      <Input
        id={`${listId}-input`}
        ref={inputRef}
        value={query}
        placeholder="Press / to search"
        autoComplete="off"
        aria-describedby={`${listId}-count`}
        className="mt-2"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && shown[0]) {
            event.preventDefault();
            onSelect(shown[0].path);
          }
          if (event.key === "Escape") onQueryChange("");
        }}
      />
      <p id={`${listId}-count`} className="text-muted-foreground mt-1.5 text-xs" aria-live="polite">
        {query.trim() === ""
          ? `${files.length} files in the map`
          : all.length === 0
            ? "No file matches"
            : `${all.length} match${all.length === 1 ? "" : "es"}, best first`}
      </p>
      {shown.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {shown.map((result) => (
            <li key={result.path}>
              <button
                type="button"
                onClick={() => onSelect(result.path)}
                className="focus-visible:ring-ring hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{result.path}</span>
                <Badge variant="outline" className="shrink-0">
                  {KIND_LABEL[result.kind]}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
