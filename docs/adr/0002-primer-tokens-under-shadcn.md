# 2. Primer tokens under shadcn, not Primer React

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** cael

## Verdict

**Keep shadcn/ui and Radix. Take GitHub's tokens and geometry from
`@primer/primitives`, and put the brand on top as a short override file.** Do
not migrate to `@primer/react`.

## Context

The product is used by developers inside GitHub pull requests and, through
the MCP server, inside editors. The dashboard should feel like the tools
around it: GitHub and VS Code. Both share a look that is mostly geometry and
neutrals, not a component API: 6px radius, 32px controls, 14px body text, 1px
borders with shadows reserved for overlays, the system font stack, and a
neutral scale with named roles (`default`, `muted`, `inset`, `emphasis`).

The brand is a teal accent (`#317a71`), teal-tinted dark canvases, and warm
sand light canvases. Everything else should conform.

`packages/design` is stock shadcn (25 components on Radix, Tailwind v4). The
previous palette commit hand-picked ~40 raw hex values into a `--palette-*`
block and mapped shadcn's semantic tokens onto them; there was no source for
the neutral scale, no contrast verification, and typography utilities the
docs pages depend on (`text-h1`, `eyebrow`, `max-w-measure`) had been dropped
in the shadcn migration and silently rendered as defaults.

## Options

**A. `@primer/react`.** Highest fidelity, zero mapping. Costs: replaces 25
working components and every call site; Primer's own theme provider and
`data-color-mode` contract; a component API and release cadence we do not
control; poor fit with Tailwind, which the app and its docs pages are written
in. The GitHub feel it buys is almost entirely reproducible from tokens.

**B. shadcn on top of `@primer/primitives`.** Import Primer's `light.css` and
`dark.css` unchanged, override the accent and canvas tokens in one file, and
alias shadcn's semantic names (`--background`, `--primary`, `--border`, …) to
Primer tokens. Reset shadcn's radius, control heights and type scale to
Primer's. Own the component layer; upgrade Primer by bumping a version.

**C. Hand-rolled palette (status quo).** No dependency, but no neutral scale
to inherit, drift with every PR, and contrast checked by eye.

## Decision

Option B, in three layers. Nobody writes in the first; the second is the
whole brand deviation; components only ever see the third.

1. `@primer/primitives` themes, plus its radius and typography files.
2. `packages/design/src/brand.css`. Accent steps are Primer's blue steps
   hue-shifted in OKLCH onto `#317a71`, keeping Primer's lightness deltas, so
   hover, active, muted and border variants stay consistent. Dark canvases
   keep Primer's lightness and take the accent hue at chroma ≤ 0.012. Light
   canvases use Primer's lightness steps at hue 75 (sand), chroma ≤ 0.014.
   `theme.test.ts` asserts WCAG AA for accent and muted text on every canvas
   and for white on the accent and attention emphasis fills.
3. `packages/design/src/theme.css` aliases shadcn names to Primer names. Two
   additions to shadcn's set: `--link` (Primer `fgColor-accent`: in dark mode
   the logo turquoise `#4aa696`, lighter than the button fill so link text
   passes AA) and `--attention` (Primer `severe`, overridden to the logo rust
   `#c3552b` for fills and coral `#f47a4d` for dark-mode text). The logo's
   navy `#1b2b41` is the light-mode ink and tooltip ground; the full logo
   palette is exposed as `--brand-*` for marks and illustrations only.

Geometry: radius 6px (`sm` 3px), buttons 32/28/40px, body 14px, Primer's
resting and floating shadows behind Tailwind's `shadow-*` scale, system sans
and mono stacks with no web font. The theme follows the OS only: Primer's
`data-color-mode="auto"` and Tailwind's default `dark:` variant; `next-themes`
and the toggle are removed.

`tokens-guard.test.ts` fails on Tailwind palette classes or raw hex in app
code, which is what stops a second palette from growing back.

## Consequences

- Primer's theme CSS is ~120KB per theme before compression, most of it
  tokens this app never reads. Acceptable for a dashboard; if it matters, a
  build step that prunes unreferenced custom properties is the fix, not
  editing the files.
- Anything new from shadcn's CLI arrives with stock radius and heights and
  needs the same reset `button.tsx` has.
- `docs/index.html` keeps its own standalone palette; it is not the app.
- Reopen this if the product needs GitHub's composite components (the
  underline nav, the data table, the action list) rather than its look.
