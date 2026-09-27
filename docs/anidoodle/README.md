# The LintCat loop

A ten-second pixel-art loop of how a review happens, drawn in code with
[anidoodle](https://github.com/alexgreensh/anidoodle). It is the picture in the README, on the
Pages walkthrough and on the dashboard's *How it works* page.

**The brief.** Kind: loop, silent. Style: anidoodle's pixel art (the cell is the mark, staircase
edges, dither for tone, cels held three frames). Shape: 16x9, 1920x1080 from a 160x90 grid.
Length: 300 frames at 30 fps. Characters: the LintCat mark, unchanged. Palette: the eight brand
tokens from `packages/design/src/brand.css` plus the two canvases and a few derived shades,
sixteen in all.

**The idea in one sentence.** A pull request rides a belt under the cat: it reads, proposes
findings, a gate with no model behind it drops the weak ones, and the rest land on the added lines
as comments and light the check run.

| Cels | Beat | What happens |
| --- | --- | --- |
| 0–24 | READ | The card slides in from the left; the cat's eyes follow it. |
| 25–49 | PROPOSE | Five candidate findings rise from the cat and ride above the card: three coral (confident), two sand and dithered (low confidence). |
| 50–74 | CHECK | Each passes the gate. The low ones fall and dissolve; the posts flash for every decision. |
| 75–99 | POST | The survivors drop onto the added rows as markers, the `AI PR REVIEW` badge lights, the card leaves and the next one is due. |

## Files

- `src/canvas-core/lintcatLoop.ts` — the film: palette, the cat, the card, the font, the cel table.
  Engine modules are imported as `anidoodle/<dir>/<module>`; the render script rewrites that to
  the relative path inside the scaffold, so the repository index never sees a dangling import.
- `src/hosts/page-lintcatLoop.ts` — the host page the engine's tools drive.
- `render.mjs` — fetches the engine at a pinned commit into `.engine/` (gitignored), scaffolds a
  project there, copies `src/` in, renders, runs anidoodle's gate, and writes the outputs to
  `docs/assets/lintcat-how-it-works.{gif,png}` and `apps/web/public/brand/how-it-works.{gif,png}`.

## Rendering

```sh
node docs/anidoodle/render.mjs            # everything, with the gate
node docs/anidoodle/render.mjs --no-gate  # skip the determinism and dead-air checks
```

Needs Node 22+, git, and a Chromium for Playwright (`PLAYWRIGHT_BROWSERS_PATH`, or
`npx playwright-core install chromium` inside `docs/anidoodle/.engine/project`). ffmpeg comes from
`ffmpeg-static`; nothing is added to the pnpm workspace. The engine is never edited: to move to a
newer anidoodle, change `SHA` in `render.mjs` and delete `.engine/`.

The GIF is rendered at half scale (six device pixels per cell) with one frame per cel, and the
poster is frame 180, mid-CHECK.
