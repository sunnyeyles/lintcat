"use client";

import Graph from "graphology";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import Sigma from "sigma";

import type { MapPalette } from "@/components/codebase-map/palette";
import type { Scene } from "@/components/codebase-map/scene";
import { clampScale, type MapHandle, type MapView } from "@/components/codebase-map/view";

export interface MapSigmaProps {
  scene: Scene;
  palette: MapPalette;
  handleRef?: RefObject<MapHandle | null>;
  className?: string;
}

const SPAN = 2000;

/** Spike only. Sigma's camera works in graph units, so the view is mapped onto it. */
export function MapSigma({ scene, palette, handleRef, className }: MapSigmaProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const viewRef = useRef<MapView>({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const graph = new Graph({ multi: false, type: "directed" });
    for (const node of scene.nodes) {
      graph.addNode(node.id, {
        x: node.x,
        y: node.y,
        size: Math.max(2, node.radius * 0.8),
        label: node.label,
        color: node.level === "changed" ? palette["--map-module-changed"] : palette["--map-module"],
      });
    }
    for (const edge of scene.edges) {
      if (!graph.hasEdge(edge.a, edge.b)) {
        graph.addEdge(edge.a, edge.b, { size: 0.4, color: palette["--map-edge"] });
      }
    }

    const renderer = new Sigma(graph, host, {
      renderLabels: false,
      allowInvalidContainer: true,
    });
    sigmaRef.current = renderer;
    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [scene, palette]);

  useImperativeHandle(
    handleRef,
    (): MapHandle => ({
      getView: () => ({ ...viewRef.current }),
      setView: (next) => {
        viewRef.current = { ...next, scale: clampScale(next.scale) };
        sigmaRef.current?.getCamera().setState({
          x: 0.5 - viewRef.current.x / SPAN,
          y: 0.5 - viewRef.current.y / SPAN,
          ratio: 1 / viewRef.current.scale,
        });
      },
      fit: () => sigmaRef.current?.getCamera().animatedReset({ duration: 0 }),
      centreOn: () => sigmaRef.current?.getCamera().animatedReset({ duration: 0 }),
    }),
    [],
  );

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
