"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { expandGroup, groupIdFor, normaliseGraph } from "@/lib/codebase-map";
import type { FindingHeat, MapGraph, NormalisedGraph } from "@/lib/codebase-map";

import type { MapAdapter } from "@/components/codebase-map/adapter";

export interface UseMapGraph {
  graph: NormalisedGraph;
  heat: FindingHeat;
  /** Groups whose files are here; the rest are summaries the adapter can fetch. */
  loadedGroups: ReadonlySet<string>;
  lod: boolean;
  pending: ReadonlySet<string>;
  error: string | null;
  ensureGroup: (groupId: string) => Promise<boolean>;
}

/**
 * The merged graph is a new object on every expansion, so nothing that must
 * survive one — the camera, the focus — may be derived from it.
 */
export function useMapGraph(
  input: MapGraph,
  inputHeat: FindingHeat,
  adapter?: MapAdapter,
): UseMapGraph {
  const [graph, setGraph] = useState(input);
  const [heat, setHeat] = useState(inputHeat);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGraph(input);
    setHeat(inputHeat);
    setPending(new Set());
    setError(null);
  }, [input, inputHeat]);

  const normalised = useMemo(() => normaliseGraph(graph), [graph]);

  const loadedGroups = useMemo(() => {
    const ids = new Set<string>();
    for (const file of normalised.files) ids.add(groupIdFor(file));
    for (const summary of normalised.summaries) ids.delete(summary.id);
    return ids;
  }, [normalised]);

  const inFlight = useRef(new Map<string, Promise<boolean>>());
  const loadedRef = useRef(loadedGroups);
  loadedRef.current = loadedGroups;

  const ensureGroup = useCallback(
    (groupId: string): Promise<boolean> => {
      if (loadedRef.current.has(groupId)) return Promise.resolve(true);
      if (!adapter) return Promise.resolve(false);
      const running = inFlight.current.get(groupId);
      if (running) return running;

      setPending((previous) => new Set(previous).add(groupId));
      const request = adapter
        .expandGroup(groupId, [...loadedRef.current])
        .then((slice) => {
          setGraph((previous) => expandGroup(previous, groupId, slice.graph));
          setHeat((previous) => ({ ...previous, ...slice.heat }));
          setError(null);
          return true;
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "could not load that group");
          return false;
        })
        .finally(() => {
          inFlight.current.delete(groupId);
          setPending((previous) => {
            const next = new Set(previous);
            next.delete(groupId);
            return next;
          });
        });

      inFlight.current.set(groupId, request);
      return request;
    },
    [adapter],
  );

  return {
    graph: normalised,
    heat,
    loadedGroups,
    lod: normalised.summaries.length > 0,
    pending,
    error,
    ensureGroup,
  };
}
