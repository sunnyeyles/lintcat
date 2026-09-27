"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { MapSession, type MapSessionSource } from "@/components/codebase-map/map-session";
import type { MapHandle } from "@/components/codebase-map/view";
import type { NavigationAxis, SceneNode } from "@/lib/codebase-map";

export interface MapHover {
  node: SceneNode;
  x: number;
  y: number;
}

function axisOf(key: string): NavigationAxis | null {
  if (key === "ArrowRight") return "dependencies";
  if (key === "ArrowLeft") return "dependents";
  if (key === "ArrowDown" || key === "ArrowUp") return "siblings";
  return null;
}

/** The session's state for React, plus the camera and pointer the canvas needs. */
export function useMapSession(source: MapSessionSource | null) {
  const [session] = useState(() => new MapSession(source));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [hover, setHover] = useState<MapHover | null>(null);

  useEffect(() => session.load(source), [session, source]);

  const { opening, scene, view } = state;

  const fitOpening = useCallback(() => {
    if (opening) handle?.fitBounds?.(opening);
    else handle?.fit();
  }, [handle, opening]);

  // Deferred a tick so a freshly mounted canvas has measured itself.
  useEffect(() => {
    const id = setTimeout(fitOpening, 0);
    return () => clearTimeout(id);
  }, [fitOpening]);

  useEffect(() => {
    if (view.focusedPath === null) return;
    const node = scene.byId.get(view.focusedPath);
    if (node) handle?.centreOn(node.x, node.y);
  }, [handle, view.focusedPath, scene]);

  const onNodeHover = useCallback(
    (node: SceneNode | null, x: number, y: number) => setHover(node ? { node, x, y } : null),
    [],
  );

  const onMapKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const axis = axisOf(event.key);
      if (axis) {
        event.preventDefault();
        session.step(axis, event.shiftKey || event.key === "ArrowUp" ? "previous" : "next");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        session.toggleFocusedGroup();
      } else if (event.key === "Escape") {
        event.preventDefault();
        session.focus(null);
      }
    },
    [session],
  );

  return {
    state,
    actions: session,
    camera: { ref: setHandle, fitAll: () => handle?.fit(), fitOpening },
    hover,
    onNodeHover,
    onMapKeyDown,
  };
}
