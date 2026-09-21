import { cn } from "@pr-review/design";

// The LintCat mark (public/brand/lintcat-mark-*.svg) drawn from brand tokens.
// "colour" is the primary mark; "mono" is navy on light canvases and cream on dark ones.
export type LogoMarkProps = {
  variant?: "colour" | "mono";
  /** "hover" runs the loader loop while the nearest [data-animate-on-hover] is hovered or focused. */
  animate?: "never" | "hover" | "always";
  className?: string;
};

// Same loop as public/brand/lintcat-loader-*.svg: gaze left, gaze right, whiskers out of phase, one-frame blink.
const LOADER_CSS = `
.lc-look{animation:lc-look 2.4s step-end infinite}
.lc-blink{transform-origin:50px 52px;animation:lc-blink 2.4s step-end infinite}
.lc-whisk-l{animation:lc-whisk 1.2s step-end infinite}
.lc-whisk-r{animation:lc-whisk 1.2s step-end infinite;animation-delay:-.6s}
[data-lc-animate="hover"] :is(.lc-look,.lc-blink,.lc-whisk-l,.lc-whisk-r){animation-play-state:paused}
[data-animate-on-hover]:is(:hover,:focus-visible) [data-lc-animate="hover"] :is(.lc-look,.lc-blink,.lc-whisk-l,.lc-whisk-r){animation-play-state:running}
@keyframes lc-look{0%,12.5%{transform:translateX(-4px)}37.5%{transform:translateX(4px)}75%,87.5%{transform:none}}
@keyframes lc-blink{0%,74.9%{transform:none}75%{transform:scaleY(.15)}87.5%,100%{transform:none}}
@keyframes lc-whisk{0%{transform:none}50%{transform:translateY(-4px)}}
@media (prefers-reduced-motion:reduce){.lc-look,.lc-blink,.lc-whisk-l,.lc-whisk-r{animation:none}}
`;

export function LogoMark({ variant = "colour", animate = "never", className }: LogoMarkProps) {
  const colour = variant === "colour";
  const body = colour ? "fill-brand-navy" : "fill-brand-navy dark:fill-brand-paper";
  const accent = colour ? "fill-brand-turquoise" : "fill-brand-paper dark:fill-brand-navy";
  const eyes = colour ? "fill-brand-paper" : "fill-brand-paper dark:fill-brand-navy";
  const pupils = colour ? "fill-brand-coral" : body;
  const whiskers = colour ? "fill-brand-turquoise" : body;
  const on = animate !== "never";

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      shapeRendering="crispEdges"
      data-lc-animate={on ? animate : undefined}
      className={cn("size-5 shrink-0", className)}
    >
      {on ? <style>{LOADER_CSS}</style> : null}
      <g className={body}>
        <rect x="14" y="8" width="20" height="22" />
        <rect x="66" y="8" width="20" height="22" />
        <rect x="10" y="30" width="80" height="58" />
      </g>
      <g className={accent}>
        <rect x="22" y="20" width="8" height="8" />
        <rect x="70" y="20" width="8" height="8" />
      </g>
      <g className={cn(on && "lc-blink")}>
        <g className={eyes}>
          <rect x="22" y="44" width="20" height="16" />
          <rect x="58" y="44" width="20" height="16" />
        </g>
        <g className={cn(pupils, on && "lc-look")}>
          <rect x="30" y="48" width="8" height="10" />
          <rect x="62" y="48" width="8" height="10" />
        </g>
      </g>
      <rect x="44" y="68" width="12" height="8" className={accent} />
      <g className={cn(whiskers, on && "lc-whisk-l")}>
        <rect x="4" y="62" width="10" height="6" />
      </g>
      <g className={cn(whiskers, on && "lc-whisk-r")}>
        <rect x="86" y="62" width="10" height="6" />
      </g>
    </svg>
  );
}

// The lockup: the full-colour mark in both modes, wordmark in the display face.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark variant="colour" animate="hover" />
      <span className="font-display text-base leading-none font-bold tracking-tight text-foreground">
        Lint<span className="text-link">Cat</span>
      </span>
    </span>
  );
}
