# The explainer

Eight drawings, one per stage of a review, shown on `/docs/how-it-works` in `apps/web`. Each is
drawn in code with [anidoodle](https://github.com/alexgreensh/anidoodle): a pure function paints
every frame, so the same source gives the same pixels on any machine.

- `STORYBOARD.md`: the stages, what each one says, and the code it cites. The agent-readable half.
- `src/canvas-core/lintcatKit.ts`: the brand palette (16 colours), the LintCat mark as a sprite
  rasterised from `apps/web/public/brand/lintcat-mark-colour.svg`, a 3x5 pixel hand for captions,
  and the grid marks (box, arrow, dial, dither) recorded as strokes.
- `src/canvas-core/stage0N*.ts`: one film per stage, `meta.kind: "drawing"`, 192 x 108 cells.
- `build.mjs`: renders everything into `apps/web/public/explainer/` (poster PNG, MP4, offline
  HTML player per stage).

## Brief

Kind: explainer. Style: anidoodle `pixelArt`, because the LintCat mark is pixel art and the
mark is the recurring guide. Shape 16:9. Silent. 8–10 s per stage, a 1.5 s hold at the end.
Palette: navy `#1E2D42`, teal `#3AA693`, cream `#F5EFE3`, coral `#F47B4E`, plus tints for dither,
one amber for warnings and one lavender for the untrusted zone.

## Building

The engine comes from the anidoodle plugin, enabled for this repo in `.claude/settings.json`.
Install it once (Claude Code fetches it on first open; or by hand):

```bash
claude plugin marketplace add alexgreensh/anidoodle
claude plugin install anidoodle@alexgreensh-anidoodle
```

Then:

```bash
pnpm explainer              # all stages
pnpm explainer 05           # one stage
pnpm explainer --stills     # final frames only, into docs/explainer/.build/out/
```

`build.mjs` scaffolds the engine into `docs/explainer/.build/` (gitignored), overlays `src/`,
installs with npm, and for every stage renders the final still (must print `reproducible`),
the MP4, runs `gate.mjs` (determinism, contract, dead air) and emits the HTML player. Set
`ANIDOODLE_ENGINE` to point at a checkout of `skills/anidoodle/engine` instead of the plugin
cache. Needs Node 20+, a Chromium build Playwright can find, and ffmpeg (Playwright's own is
picked up from `PLAYWRIGHT_BROWSERS_PATH`).

## Honest limits

Nobody here can watch the films move: the gate measures determinism and dead air, and the
stills are eyeballed. Watch one MP4 before trusting the pacing.
