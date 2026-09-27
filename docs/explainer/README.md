# The explainer

Eight drawings, one per stage of a review, shown on `/docs/how-it-works` in `apps/web`. Each is
drawn in code with [anidoodle](https://github.com/alexgreensh/anidoodle): a pure function lays
every pixel in order, so the same source gives the same pixels on any machine.

- `STORYBOARD.md`: the stages, what each one says, and the code it cites. The agent-readable half.
- `src/canvas-core/lintcatKit.ts`: the light and dark palettes (16 colours each), the LintCat
  mark as a sprite rasterised from `apps/web/public/brand/lintcat-mark-colour.svg`, a 5x9 pixel
  hand for captions, and the grid marks (box, arrow, dial, dither) recorded as strokes.
- `src/canvas-core/stage0N*.ts`: one film per stage, `meta.kind: "drawing"`. Stages are authored
  in 192 x 108 design units; the kit lays every mark on a grid twice as fine, 384 x 216 cells.
- `build.mjs`: verifies every stage and bundles each drawing into
  `apps/web/public/explainer/<stage>.js`.

The page does not play a video. `apps/web/components/docs/stage-figure.tsx` loads the bundle
and replays the drawing onto a canvas at the screen's own resolution, so every cell is whole
device pixels. It picks the light or dark palette from the page's colour mode, repaints when the
mode changes, and takes paper from the page's `--background`, so the drawing and the page share
one background exactly. It animates only while on screen; under reduced motion it shows the
finished picture.

## Brief

Kind: explainer. Style: anidoodle `pixelArt`, because the LintCat mark is pixel art and the
mark is the recurring guide. Shape 16:9. Silent. 8–10 s per stage, a 1.5 s hold at the end.
Palette: navy `#1E2D42`, teal `#3AA693`, coral `#F47B4E`, plus tints for dither, one amber for
warnings and one lavender for the untrusted zone. Light mode draws on paper `#FAF6EE` with navy
ink; dark mode on `#0B1311` with `#EEF8F6` ink and deep tints. The cat stays navy in both, as the
topbar mark does.

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
installs with npm, and for every stage renders the final still (must print `reproducible`) and
an MP4 into `.build/out/`, runs `gate.mjs` (determinism, contract, dead air on that MP4), then
bundles the drawing with esbuild. Only the bundles are committed. Set `ANIDOODLE_ENGINE` to
point at a checkout of `skills/anidoodle/engine` instead of the plugin cache. Needs Node 20+, a
Chromium build Playwright can find (`PLAYWRIGHT_BROWSERS_PATH`), and ffmpeg with libx264 for
the gate's MP4 (fetched into `.build` when missing).

The stills and MP4 use the light palette; check dark mode on the page itself.
