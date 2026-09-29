"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pr-review/design";
import { Activity, useState, type ReactNode } from "react";

import { FindingsFocusProvider, useFindingsFocus, type ReviewView } from "./findings-focus";

export type ReviewTabsProps = {
  findingCount: number;
  findings: ReactNode;
  change: ReactNode;
  map: ReactNode;
};

// Radix only sets `hidden` on unmounted panels, and these stay mounted.
const PANEL = "data-[state=inactive]:hidden";

export function ReviewTabs(props: ReviewTabsProps) {
  return (
    <FindingsFocusProvider>
      <Views {...props} />
    </FindingsFocusProvider>
  );
}

function Views({ findingCount, findings, change, map }: ReviewTabsProps) {
  const { view, setView } = useFindingsFocus();
  const [mapOpened, setMapOpened] = useState(false);

  const select = (next: string) => {
    const chosen = next as ReviewView;
    if (chosen === "map") setMapOpened(true);
    setView(chosen);
  };
  const mode = (panel: ReviewView) => (view === panel ? "visible" : "hidden");

  return (
    <Tabs value={view} onValueChange={select} className="gap-6">
      <TabsList variant="line" aria-label="Review views" className="w-full justify-start">
        <TabsTrigger value="findings">
          Findings
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {findingCount}
          </span>
        </TabsTrigger>
        <TabsTrigger value="change">Change</TabsTrigger>
        <TabsTrigger value="map">Map</TabsTrigger>
      </TabsList>

      <TabsContent value="findings" forceMount className={PANEL}>
        <Activity mode={mode("findings")}>{findings}</Activity>
      </TabsContent>
      <TabsContent value="change" forceMount className={PANEL}>
        <Activity mode={mode("change")}>{change}</Activity>
      </TabsContent>
      <TabsContent value="map" forceMount className={PANEL}>
        {mapOpened ? <Activity mode={mode("map")}>{map}</Activity> : null}
      </TabsContent>
    </Tabs>
  );
}
