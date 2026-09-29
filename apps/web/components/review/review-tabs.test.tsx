import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewTabs } from "./review-tabs";

function render(findingCount = 3): string {
  return renderToStaticMarkup(
    <ReviewTabs
      findingCount={findingCount}
      findings={<p>findings-panel</p>}
      change={<p>change-panel</p>}
      map={<p>map-panel</p>}
    />,
  );
}

describe("ReviewTabs", () => {
  it("opens on the findings, with a tab for the change and the map", () => {
    const html = render();
    expect(html).toContain("findings-panel");
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-selected="true"[^>]*>Findings/);
  });

  it("does not mount the map before its tab is opened", () => {
    expect(render()).not.toContain("map-panel");
  });

  it("shows a count of zero rather than dropping it", () => {
    expect(render(0)).toMatch(/Findings<span[^>]*>0<\/span>/);
  });
});
