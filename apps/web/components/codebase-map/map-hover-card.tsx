import type { MapHover } from "@/components/codebase-map/use-map-explorer";

export function MapHoverCard({ hover }: { hover: MapHover | null }) {
  if (!hover) return null;
  const { node } = hover;
  return (
    <div
      className="border-border bg-popover text-popover-foreground pointer-events-none fixed z-50 max-w-sm rounded-md border px-2 py-1 font-mono text-xs shadow-md"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
    >
      {node.sublabel}
      {node.kind === "group" ? ` · ${node.fileCount} files, ${node.changedCount} changed` : ""}
      {node.heat.counts.total > 0 ? ` · ${node.heat.counts.total} findings` : ""}
    </div>
  );
}
