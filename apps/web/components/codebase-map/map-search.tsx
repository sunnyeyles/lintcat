"use client";

import { Badge, Input } from "@pr-review/design";
import { useEffect, useId, useState, type RefObject } from "react";

import { searchFiles } from "@/lib/codebase-map";
import type { LodSearchResult, MapFile, SearchResult } from "@/lib/codebase-map";

const SHOWN = 12;
const DEBOUNCE_MS = 200;

export interface MapSearchProps {
  files: readonly MapFile[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (path: string, groupId?: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Set when the map holds only part of the repo: the server does the ranking. */
  searcher?: ((query: string) => Promise<LodSearchResult[]>) | undefined;
  fileCount?: number | undefined;
}

const KIND_LABEL = {
  "name-prefix": "name",
  segment: "folder",
  substring: "text",
} as const;

function groupOf(result: SearchResult): string | undefined {
  return (result as LodSearchResult).groupId || undefined;
}

export function MapSearch({
  files,
  query,
  onQueryChange,
  onSelect,
  inputRef,
  searcher,
  fileCount,
}: MapSearchProps) {
  const listId = useId();
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!searcher) return;
    if (query.trim() === "") {
      setRemote([]);
      return;
    }
    let live = true;
    setSearching(true);
    const id = setTimeout(() => {
      searcher(query)
        .then((results) => live && setRemote(results))
        .catch(() => live && setRemote([]))
        .finally(() => live && setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, searcher]);

  const all = searcher ? remote : searchFiles(files, query);
  const shown = all.slice(0, SHOWN);
  const total = fileCount ?? files.length;

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
            onSelect(shown[0].path, groupOf(shown[0]));
          }
          if (event.key === "Escape") onQueryChange("");
        }}
      />
      <p id={`${listId}-count`} className="text-muted-foreground mt-1.5 text-xs" aria-live="polite">
        {query.trim() === ""
          ? `${total} files in the map`
          : searching
            ? "Searching the repo"
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
                onClick={() => onSelect(result.path, groupOf(result))}
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
