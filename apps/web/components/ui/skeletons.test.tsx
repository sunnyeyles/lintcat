import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChartCardSkeleton } from "./skeletons";

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("ChartCardSkeleton", () => {
  it("draws gridlines and an area silhouette by default", () => {
    const html = renderToStaticMarkup(<ChartCardSkeleton />);
    expect(count(html, 'data-slot="chart-skeleton-gridline"')).toBe(5);
    expect(count(html, "<path")).toBe(1);
    expect(count(html, 'data-slot="chart-skeleton-bar"')).toBe(0);
  });

  it("draws one bar per category for the bars kind", () => {
    const html = renderToStaticMarkup(<ChartCardSkeleton kind="bars" />);
    expect(count(html, 'data-slot="chart-skeleton-bar"')).toBe(7);
    expect(count(html, "<path")).toBe(0);
  });

  it("adds a legend only when asked", () => {
    expect(renderToStaticMarkup(<ChartCardSkeleton />)).not.toContain("chart-skeleton-legend");
    expect(renderToStaticMarkup(<ChartCardSkeleton legend />)).toContain("chart-skeleton-legend");
  });

  it("hides the plot from assistive tech at the requested height", () => {
    const html = renderToStaticMarkup(<ChartCardSkeleton height={280} />);
    expect(html).toMatch(/aria-hidden="true"[^>]*style="height:280px"/);
  });
});
