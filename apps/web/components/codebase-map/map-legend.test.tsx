import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MapLegend } from "@/components/codebase-map/map-legend";

const overlay = (shown: boolean) => ({ shown, onShownChange: () => {} });

describe("MapLegend", () => {
  it("has no impacted entry or switch for a map without impacted files", () => {
    const markup = renderToStaticMarkup(<MapLegend />);

    expect(markup).not.toMatch(/impacted/i);
    expect(markup).not.toContain('role="switch"');
  });

  it("lists impacted files in their own colour, with the overlay switch on", () => {
    const markup = renderToStaticMarkup(<MapLegend impacted={overlay(true)} />);

    expect(markup).toContain("Impacted: depends on the change");
    expect(markup).toContain("Collapsed directory holding impacted files");
    expect(markup).toContain('stroke="var(--map-module-impacted)"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
  });

  it("shows the switch off once the overlay is hidden", () => {
    const markup = renderToStaticMarkup(<MapLegend impacted={overlay(false)} />);

    expect(markup).toContain('aria-checked="false"');
  });
});
