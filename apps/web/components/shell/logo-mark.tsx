import { cn } from "@pr-review/design";

// The LintCat mark (public/brand/lintcat-mark-*.svg) drawn from brand tokens.
// "colour" is the primary mark; "mono" is navy on light canvases and cream on dark ones.
export type LogoMarkProps = { variant?: "colour" | "mono"; className?: string };

const BODY = (
  <>
    <rect x="14" y="8" width="20" height="22" />
    <rect x="66" y="8" width="20" height="22" />
    <rect x="10" y="30" width="80" height="58" />
  </>
);
const EAR_TIPS_AND_NOSE = (
  <>
    <rect x="22" y="20" width="8" height="8" />
    <rect x="70" y="20" width="8" height="8" />
    <rect x="44" y="68" width="12" height="8" />
  </>
);
const WHISKERS = (
  <>
    <rect x="4" y="62" width="10" height="6" />
    <rect x="86" y="62" width="10" height="6" />
  </>
);
const EYES = (
  <>
    <rect x="22" y="44" width="20" height="16" />
    <rect x="58" y="44" width="20" height="16" />
  </>
);
const PUPILS = (
  <>
    <rect x="30" y="48" width="8" height="10" />
    <rect x="62" y="48" width="8" height="10" />
  </>
);

export function LogoMark({ variant = "colour", className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      shapeRendering="crispEdges"
      className={cn("size-5 shrink-0", className)}
    >
      {variant === "colour" ? (
        <>
          <g className="fill-brand-navy">{BODY}</g>
          <g className="fill-brand-turquoise">
            {EAR_TIPS_AND_NOSE}
            {WHISKERS}
          </g>
          <g className="fill-brand-paper">{EYES}</g>
          <g className="fill-brand-coral">{PUPILS}</g>
        </>
      ) : (
        <>
          <g className="fill-brand-navy dark:fill-brand-paper">
            {BODY}
            {PUPILS}
            {WHISKERS}
          </g>
          <g className="fill-brand-paper dark:fill-brand-navy">
            {EAR_TIPS_AND_NOSE}
            {EYES}
          </g>
        </>
      )}
    </svg>
  );
}

// The lockup: the full-colour mark in both modes, wordmark in the display face.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark variant="colour" />
      <span className="font-display text-base leading-none font-bold tracking-tight text-foreground">
        Lint<span className="text-link">Cat</span>
      </span>
    </span>
  );
}
