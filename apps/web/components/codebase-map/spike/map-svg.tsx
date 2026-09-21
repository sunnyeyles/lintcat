"use client";

import { useCallback, useImperativeHandle, useMemo, useRef, type RefObject } from "react";

import { markerParts } from "@/components/codebase-map/markers";
import type { MapPalette } from "@/components/codebase-map/palette";
import type { Scene } from "@/components/codebase-map/scene";
import { clampScale, fitView, type MapHandle, type MapView } from "@/components/codebase-map/view";

export interface MapSvgProps {
  scene: Scene;
  palette: MapPalette;
  handleRef?: RefObject<MapHandle | null>;
  className?: string;
}

/** Spike only. Pan and zoom move one transform attribute, which is SVG at its best. */
export function MapSvg({ scene, palette, handleRef, className }: MapSvgProps) {
  const hostRef = useRef<SVGSVGElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const viewRef = useRef<MapView>({ x: 0, y: 0, scale: 1 });

  const apply = useCallback(() => {
    const view = viewRef.current;
    groupRef.current?.setAttribute(
      "transform",
      `translate(${view.x} ${view.y}) scale(${view.scale})`,
    );
  }, []);

  useImperativeHandle(
    handleRef,
    (): MapHandle => ({
      getView: () => ({ ...viewRef.current }),
      setView: (next) => {
        viewRef.current = { ...next, scale: clampScale(next.scale) };
        apply();
      },
      fit: () => {
        const rect = hostRef.current?.getBoundingClientRect();
        viewRef.current = fitView(scene.bounds, rect?.width ?? 1, rect?.height ?? 1);
        apply();
      },
      centreOn: (x, y, scale) => {
        const rect = hostRef.current?.getBoundingClientRect();
        const next = clampScale(scale ?? viewRef.current.scale);
        viewRef.current = {
          scale: next,
          x: (rect?.width ?? 1) / 2 - x * next,
          y: (rect?.height ?? 1) / 2 - y * next,
        };
        apply();
      },
    }),
    [apply, scene.bounds],
  );

  const edges = useMemo(
    () =>
      scene.edges.map((edge, i) => (
        <line
          key={i}
          x1={edge.ax}
          y1={edge.ay}
          x2={edge.bx}
          y2={edge.by}
          stroke={palette["--map-edge"]}
          strokeWidth={0.6}
        />
      )),
    [scene.edges, palette],
  );

  const nodes = useMemo(
    () =>
      scene.nodes.flatMap((node) =>
        markerParts(node.marker, node.radius, node.direction).map((part, i) => (
          <path
            key={`${node.id}:${i}`}
            d={part.d}
            transform={`translate(${node.x} ${node.y})`}
            fill={part.mode === "fill" ? palette["--map-module"] : "none"}
            stroke={part.mode === "stroke" ? palette["--map-module"] : "none"}
            strokeWidth={part.width}
          />
        )),
      ),
    [scene.nodes, palette],
  );

  return (
    <svg ref={hostRef} className={className} aria-hidden="true">
      <g ref={groupRef}>
        <g>{edges}</g>
        <g>{nodes}</g>
      </g>
    </svg>
  );
}
