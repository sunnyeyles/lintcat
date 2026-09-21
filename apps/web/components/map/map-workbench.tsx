"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@pr-review/design";
import {
  CircleDashed,
  GitBranch,
  LayoutGrid,
  List,
  Map as MapIcon,
  Maximize2,
  Minus,
  Network,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { CodebaseMap, KIND_COLOR } from "@/components/map/codebase-map";
import { ArcView, ListView, TreemapView } from "@/components/map/map-views";
import { FilePath } from "@/components/review/file-path";
import { Stat, StatGrid } from "@/components/ui/stat";
import {
  DEFAULT_VIEW,
  type FileKind,
  type Highlight,
  type MapGraph,
  type MapView,
  neighbours,
  stats,
} from "@/lib/codebase-map-view";

const KIND_LABEL: Record<FileKind, string> = {
  source: "Source",
  test: "Tests",
  config: "Config",
  docs: "Docs",
};
const KINDS = Object.keys(KIND_LABEL) as FileKind[];

const HIGHLIGHT_LABEL: Record<Highlight, string> = {
  changed: "Changed in PR",
  dependencies: "Dependencies",
  dependents: "Dependents",
  none: "Nothing",
};

const ZOOM_STEPS = [0.75, 1, 1.35, 1.8];

export type MapWorkbenchProps = {
  graph: MapGraph;
  pr: { number: number; title: string };
};

export function MapWorkbench({ graph, pr }: MapWorkbenchProps) {
  const [view, setView] = useState<MapView>(DEFAULT_VIEW);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [mode, setMode] = useState("map");
  const totals = useMemo(() => stats(graph), [graph]);
  const focused = view.focus ? graph.nodes.find((n) => n.id === view.focus) : undefined;
  const around = view.focus ? neighbours(graph, view.focus) : null;

  const update = (patch: Partial<MapView>) => setView((v) => ({ ...v, ...patch }));
  const toggleKind = (kind: FileKind) => {
    const kinds = new Set(view.kinds);
    if (kinds.has(kind)) kinds.delete(kind);
    else kinds.add(kind);
    update({ kinds });
  };

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat label="Files in map" value={totals.files} hint="Every file the index knows about." />
        <Stat
          label="Touched by this PR"
          value={totals.changed}
          delta={{ value: `${Math.round((totals.changed / totals.files) * 100)}% of repo`, tone: "neutral" }}
        />
        <Stat label="Import edges" value={totals.edges} />
        <Stat
          label="Problem areas"
          value={totals.cycles + totals.dead}
          hint={`${totals.cycles} in cycles · ${totals.dead} unreferenced`}
          delta={{ value: "needs a look", tone: "warn" }}
        />
      </StatGrid>

      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                type="search"
                placeholder="Find a file…"
                aria-label="Find a file"
                className="pl-8"
                value={view.query}
                onChange={(event) => update({ query: event.target.value })}
              />
            </div>
            <Select defaultValue="pr">
              <SelectTrigger aria-label="Scope" className="w-[12rem]">
                <GitBranch aria-hidden className="size-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pr">PR #{pr.number}</SelectItem>
                <SelectItem value="main">main</SelectItem>
                <SelectItem value="compare">Compare to base…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="highlight" className="text-muted-foreground">Highlight</Label>
              <Select value={view.highlight} onValueChange={(v) => update({ highlight: v as Highlight })}>
                <SelectTrigger id="highlight" className="w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(HIGHLIGHT_LABEL) as Highlight[]).map((h) => (
                    <SelectItem key={h} value={h}>{HIGHLIGHT_LABEL[h]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList aria-label="View">
                <TabsTrigger value="map"><MapIcon aria-hidden /> Map</TabsTrigger>
                <TabsTrigger value="treemap"><LayoutGrid aria-hidden /> Treemap</TabsTrigger>
                <TabsTrigger value="arcs"><Network aria-hidden /> Arcs</TabsTrigger>
                <TabsTrigger value="list"><List aria-hidden /> List</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            aria-label="File kinds"
            value={[...view.kinds]}
          >
            {KINDS.map((kind) => (
              <ToggleGroupItem
                key={kind}
                value={kind}
                aria-label={KIND_LABEL[kind]}
                onClick={() => toggleKind(kind)}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: KIND_COLOR[kind] }} />
                {KIND_LABEL[kind]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <div className="flex items-center gap-2">
            <Switch id="dead" checked={view.showDead} onCheckedChange={(showDead) => update({ showDead })} />
            <Label htmlFor="dead">Unreferenced files</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="cycles" checked={view.showCycles} onCheckedChange={(showCycles) => update({ showCycles })} />
            <Label htmlFor="cycles">Import cycles</Label>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
                  <Minus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>
            <span className="text-muted-foreground w-10 text-center font-mono text-xs tabular-nums">
              {Math.round((ZOOM_STEPS[zoomIndex] ?? 1) * 100)}%
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Zoom in" disabled={zoomIndex === ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}>
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Fit to view" onClick={() => setZoomIndex(1)}>
                  <Maximize2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit to view</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="relative min-h-[28rem] border-b lg:border-r lg:border-b-0">
            {mode === "map" ? (
              <CodebaseMap
                graph={graph}
                view={view}
                zoom={ZOOM_STEPS[zoomIndex] ?? 1}
                onFocus={(focus) => update({ focus })}
                className="absolute inset-0"
              />
            ) : mode === "treemap" ? (
              <TreemapView graph={graph} view={view} onFocus={(focus) => update({ focus })} className="absolute inset-0 p-2" />
            ) : mode === "arcs" ? (
              <ArcView graph={graph} view={view} onFocus={(focus) => update({ focus })} className="absolute inset-0" />
            ) : (
              <ListView graph={graph} view={view} onFocus={(focus) => update({ focus })} className="absolute inset-0" />
            )}
            <div className="text-muted-foreground pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <LegendSwatch color="var(--map-module-changed)" ring>Changed</LegendSwatch>
              <LegendSwatch color="var(--warning)" dashed>Cycle</LegendSwatch>
              <LegendSwatch color="var(--destructive)" dashed>Unreferenced</LegendSwatch>
            </div>
          </div>

          <aside className="flex flex-col gap-4 p-4" aria-label="Selected file">
            {focused && around ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardDescription>Selected file</CardDescription>
                    <CardTitle className="mt-1 text-sm">
                      <FilePath file={focused.id} />
                    </CardTitle>
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label="Clear selection" onClick={() => update({ focus: null })}>
                    <X />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{KIND_LABEL[focused.kind]}</Badge>
                  {focused.changed ? <Badge variant="attention">Changed</Badge> : null}
                  {focused.cycle ? <Badge variant="outline" className="border-warning/40 text-warning">In a cycle</Badge> : null}
                  {focused.dead ? <Badge variant="outline" className="border-destructive/40 text-destructive">Unreferenced</Badge> : null}
                </div>
                <NeighbourList title="Imports" items={around.imports} onPick={(id) => update({ focus: id })} />
                <NeighbourList title="Imported by" items={around.importedBy} onPick={(id) => update({ focus: id })} />
              </>
            ) : (
              <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm">
                <CircleDashed aria-hidden className="size-6" />
                <p>Select a file to see what it imports and what depends on it.</p>
              </div>
            )}
          </aside>
        </CardContent>
      </Card>
    </div>
  );
}

function LegendSwatch({ color, ring, dashed, children }: { color: string; ring?: boolean; dashed?: boolean; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn("size-2.5 rounded-full", dashed && "border border-dashed bg-transparent")}
        style={dashed ? { borderColor: color } : { backgroundColor: color, boxShadow: ring ? "inset 0 0 0 2px var(--background)" : undefined }}
      />
      {children}
    </span>
  );
}

function NeighbourList({ title, items, onPick }: { title: string; items: string[]; onPick: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground text-xs font-medium">
        {title} <span className="tabular-nums">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">None in the index.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onPick(id)}
                className="hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 rounded-md px-2 py-1 text-left text-xs outline-none focus-visible:ring-2"
              >
                <FilePath file={id} className="w-full" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
