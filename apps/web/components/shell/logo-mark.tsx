import { cn } from "@pr-review/design";

// The LintCat mark from the logo concept; the body flips to paper on dark canvases.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      shapeRendering="crispEdges"
      className={cn("size-5 shrink-0", className)}
    >
      <g className="fill-brand-navy dark:fill-brand-paper">
        <rect x="14" y="8" width="20" height="22" />
        <rect x="66" y="8" width="20" height="22" />
        <rect x="10" y="30" width="80" height="58" />
      </g>
      <g className="fill-brand-coral">
        <rect x="22" y="20" width="8" height="8" />
        <rect x="70" y="20" width="8" height="8" />
        <rect x="44" y="68" width="12" height="8" />
      </g>
      <g className="fill-brand-paper dark:fill-brand-navy">
        <rect x="22" y="44" width="20" height="16" />
        <rect x="58" y="44" width="20" height="16" />
      </g>
      <g className="fill-brand-turquoise">
        <rect x="30" y="48" width="8" height="10" />
        <rect x="62" y="48" width="8" height="10" />
      </g>
      <g className="fill-brand-teal dark:fill-brand-turquoise">
        <rect x="4" y="62" width="10" height="6" />
        <rect x="86" y="62" width="10" height="6" />
      </g>
    </svg>
  );
}
