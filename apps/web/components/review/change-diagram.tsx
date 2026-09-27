"use client";

import { ChangeDiagramSvg } from "@/components/codebase-map/change-diagram-svg";
import type { ChangeDiagram } from "@/lib/codebase-map";

import { useFindingsFocus } from "./findings-focus";

export function ReviewChangeDiagram({ diagram }: { diagram: ChangeDiagram }) {
  const { showFile } = useFindingsFocus();
  return (
    <ChangeDiagramSvg
      width={diagram.width}
      height={diagram.height}
      boxes={diagram.boxes}
      nodes={diagram.nodes}
      edges={diagram.edges}
      onSelect={showFile}
      capped
    />
  );
}
