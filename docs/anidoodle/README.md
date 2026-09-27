# The how-it-works film

The pixel-art explainer on `/docs/how-it-works` is drawn in code with
[anidoodle](https://github.com/alexgreensh/anidoodle) and rebuilt from this folder. The rendered
files are committed under `apps/web/public/how-it-works/`; this folder is the recipe.

```
src/canvas-core/lintcatReviewPalette.ts   the twelve colours
src/canvas-core/lintcatReviewKit.ts       bitmap font, the mark as rects, steps, the timeline checker
src/canvas-core/lintcatReview.ts          the seven chapters and the Film
src/hosts/page-lintcatReview.ts           host page (anidoodle's mountFilm)
STORYBOARD.md                             brief, claims ledger, layout, shot table
build.sh                                  fetches the engine, renders, gates, publishes
check-palette.mjs                         fails on any off-palette pixel
```

## Rebuild

```bash
bash docs/anidoodle/build.sh          # setup + render; ~5 minutes cold
bash docs/anidoodle/build.sh render   # after editing src/, with the engine already fetched
```

`build.sh` clones anidoodle at the commit pinned in the script into `.engine/`, scaffolds its engine
into `.work/`, copies `src/` over it, installs the three packages the tools need (esbuild,
playwright-core, typescript) at the versions the engine's lock names, and puts a full ffmpeg and
ffprobe on `PATH` from `ffmpeg-static` and `ffprobe-static` in `.tools/` (the Playwright ffmpeg has
no GIF encoder). All three directories are gitignored. It then typechecks, renders a smoke still,
the MP4 the gate measures, runs `gate.mjs` (determinism, contract, dead air), renders the GIF at
`--scale 0.4 --gif-fps 10` (one GIF frame per three-frame cel, 4-px cells), the poster, and the
self-contained HTML player, checks the palette, and copies the outputs into `apps/web/public/`.

Needs Node 22+, a Chromium build where Playwright looks for one (`PLAYWRIGHT_BROWSERS_PATH`), and
network access for the first run. CI never runs this; after changing `src/`, run it and commit the
outputs.

## Editing

The film is a pure function of the frame number: no clock, no `Math.random`, no assets. The
timeline is a list of steps per chapter, each laying its cells over a range of cels; `checkTimeline`
throws at module load if a cel would repeat or a second would go quiet, so a broken edit fails in
`still.mjs` before anything renders. Keep every on-screen claim in `STORYBOARD.md` with its source.

Engine modules are imported as `anidoodle-engine/<path>`, which `build.sh` maps to the scaffolded
`src/` through the work tree's tsconfig `paths` (esbuild and tsc both read it). In the repository
that specifier matches no package, so the repository indexer counts it as third-party rather than
as an unresolved import; a relative import of an engine file would fail
`packages/index/src/repository.test.ts`.

## Licence

anidoodle is © Alex Greenshpun, Apache-2.0. The emitted player bundles its engine; the film source
here is part of this repository.
