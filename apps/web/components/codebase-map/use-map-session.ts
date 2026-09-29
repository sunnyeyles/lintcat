"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { MapSession, type MapSessionSource } from "@/components/codebase-map/map-session";
import type { MapHandle } from "@/components/codebase-map/view";
import type { NavigationAxis, SceneNode } from "@/lib/codebase-map";

export interface MapHover {
  node: SceneNode;
  x: number;
  y: number;
}

const UNFITTED = Symbol("unfitted");

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

  // Camera moves are remembered, so an effect re-run by re-showing a hidden map leaves it put.
  const fitted = useRef<unknown>(UNFITTED);
  const centred = useRef<{ path: string; scene: unknown } | null>(null);

  // Deferred a tick so a freshly mounted canvas has measured itself.
  useEffect(() => {
    if (!handle || fitted.current === opening) return;
    const id = setTimeout(() => {
      fitted.current = opening;
      fitOpening();
    }, 0);
    return () => clearTimeout(id);
  }, [handle, opening, fitOpening]);

  useEffect(() => {
    const path = view.focusedPath;
    if (path === null || !handle) return;
    if (centred.current?.path === path && centred.current.scene === scene) return;
    const node = scene.byId.get(path);
    if (!node) return;
    centred.current = { path, scene };
    handle.centreOn(node.x, node.y);
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
