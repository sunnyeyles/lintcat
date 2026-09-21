# Rendering the codebase map

**Chosen: a hand-rolled Canvas 2D renderer** (`apps/web/components/codebase-map/map-canvas.tsx`).

## What was measured

`/dev/codebase-map/spike` draws `sampleRepo(7, n)` three ways — Canvas 2D, React-rendered
SVG, and sigma.js v3 + graphology (WebGL) — with every group expanded, so every file is a
node. Two numbers per renderer: the gap between painted frames during a scripted pan and
zoom, and the time from a focus change to the first frame that shows it.

Chrome on macOS, a 75 Hz display, a ~1000×600 surface, `next dev`. **13.3 ms is the vsync
floor here**, so it means "as fast as the display allows", not "the renderer's limit".

Pan and zoom, mean frame gap:

| files | nodes / edges | Canvas 2D | SVG | sigma.js |
| ----- | ------------- | --------- | --- | -------- |
| 1k | 1000 / 942 | 13.3 ms (75 fps) | 13.3 ms (75 fps) | 13.3 ms (75 fps) |
| 5k | 5000 / 4648 | 13.3 ms (75 fps) | 13.3 ms (75 fps) | 13.3 ms (75 fps) |
| 10k | 10000 / 9357 | 14.7 ms (68 fps) | 24.6 ms (41 fps) | 13.3 ms (75 fps) |

Focus change, mean time to the first frame showing the new emphasis:

| files | Canvas 2D | SVG | sigma.js |
| ----- | --------- | --- | -------- |
| 1k | 34 ms | 119 ms | 117 ms |
| 5k | 89 ms | 316 ms | 158 ms |
| 10k | 157 ms | 570 ms | 263 ms |

Rebuilding the scene from the pure module is in all three columns and costs ~134 ms of the
Canvas figure at 10k, so the drawing itself is ~20 ms. The rest is each renderer's own work.

## Why the others lost

**SVG** is genuinely fine to 5k: pan and zoom held vsync, because moving one `transform`
attribute does not relayout the children, and that is SVG at its best. It loses on the
interaction that matters. Every focus change rewrites the attributes of thousands of
elements, and at 5k that is 316 ms — a third of a second of frozen page per click, against
89 ms for canvas. At 10k it also drops to 41 fps on pan.

**sigma.js** matched canvas on pan at every size and beat SVG on focus, but its node
programs draw circles. Shape markers per emphasis level and dashed-versus-solid edges for
import direction are the whole reason this map does not rest on colour, and getting them
out of sigma means writing custom WebGL programs — more code than the canvas renderer is in
total, plus a dependency. It stays in the repo as a dev dependency so the spike still runs.

## What the canvas renderer does

One `Path2D` per marker shape, cached and stamped into a batch per shape-and-colour, so a
frame is a handful of `fill`/`stroke` calls rather than one per node. Edges are three paths,
one per relation. Off-screen nodes and base edges are culled. Parsing a path string per node
per frame was the entire budget at 10k before the cache; it is the single change that took
10k from 34 fps to 68.

Colours are read from the theme's CSS custom properties and re-read when the theme class
changes, because a canvas cannot inherit them.
