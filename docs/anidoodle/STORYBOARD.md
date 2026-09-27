# LintCat · how a review works — storyboard

A silent pixel-art explainer, 35 s, 16:9, built with anidoodle's `pixelArt` hand. It plays on
`/docs/how-it-works` as a looping GIF, with a self-contained player linked for full size.

## The brief

- **Kind**: explainer film, one idea per chapter, marks laid on (never faded), captions in product
  words (READ · PROPOSE · CHECK · POST). Audience: an engineer deciding whether to install LintCat.
- **Style**: pixel art. A 192 × 108 cell grid blown up by a whole number, twelve palette colours,
  cels held three frames (a 10 fps feel). The LintCat mark is already a blocky cat, so it is the
  recurring guide, drawn from the brand SVG's own rectangles.
- **Story in three sentences.** A pull request opens and LintCat's GitHub App queues a review.
  LintCat reads the diff and the code around it, proposes candidate findings, and checks every one:
  not on a changed line, below 0.70 confidence, a duplicate, or a fix that does not match the file,
  and it is dropped. What passes lands on the pull request as inline comments and one check run;
  nothing unchecked ever reaches it.
- **Transformation**: proposed → proven. **Token**: the finding card, planted in PROPOSE, returned
  in POST as an inline comment; and the strip `READ PROPOSE CHECK POST` lighting word by word.
  **Turn**: the first card struck through in CHECK (frame 660).
- **Sound**: none. **Shape**: 1920 × 1080 source; the GIF ships at 768 × 432 (4-px cells).

## Claims ledger

Every statement on screen, where it comes from, and what it simplifies.

| On screen | Claim | Source | Simplified |
|---|---|---|---|
| A PULL REQUEST OPENS · QUEUE · WORKER | A `pull_request` webhook reaches the GitHub App, a review job is queued, a worker claims it | `apps/web/app/api/github/webhook/handler.ts` (`onPullRequest`, `enqueueReviewJob`), `apps/worker/src/run-job.ts` | The signature check, review modes and the worker ping are left out |
| ONE JOB PER HEAD | A newer push supersedes the queued job for the same pull request | `packages/db/src/review-jobs.ts` (`superseded`, `ne(reviewJobs.headSha, …)`) | |
| DIFF · CONTEXT · BEFORE · IMPORTS · TESTS | The reviewer reads the diff, the surrounding code, the previous version, the importers and the tests | `packages/ai/src/agents/tools.ts` (`get_diff`, `get_file`, `get_base_file`, `find_references`, `find_co_changed_files`, `search_repository`); `/docs/how-it-works` "Read" | Five pages stand for eight tools |
| 8 READ-ONLY TOOLS | Eight tools, all read-only | `packages/ai/src/agents/tools.ts`: eight `tool({…})` entries | |
| UP TO 12 TURNS | The tool loop stops at 12 steps | `packages/ai/src/agents/runtime.ts` (`DEFAULT_MAX_TURNS = 12`, `isStepCount`) | |
| CORRECT · SECURITY · PERF · TESTS · DOCS | Findings are proposed in these categories | `apps/web/lib/docs.ts` (`LOOKS_FOR`); the docs page "What it looks for" | Labels shortened to fit a card |
| 0.91 … 0.55 | Each finding carries a confidence | `packages/schemas` `ReviewFinding.confidence`; `validate-findings.ts` | Values are illustrative |
| ON A CHANGED LINE · NOT CHANGED | A finding must sit on a line the pull request added | `packages/reviewer/src/validate-findings.ts` steps 3–4 | |
| 0.70+ · UNSURE 0.55 | Findings under the confidence threshold are dropped | `validate-findings.ts` (`CONFIDENCE_THRESHOLD = 0.7`) | |
| UNIQUE · DUPLICATE | Duplicates are removed, strongest kept | `validate-findings.ts` step 6 (`duplicateKeys`) | The cap of 10 (step 7) is not shown |
| The proven line lights up · FIX | A fix is offered only when its expected text matches the file at the head commit byte for byte | `packages/reviewer/src/validate-patches.ts` (`matchesExpected`) | Limits of 5 files / 200 lines not shown |
| 3 OF 6 SURVIVE | Some candidates fail the checks | The chain above | Illustrative count |
| Inline comments with FIX buttons · NOTE | Survivors post as inline review comments; verified patches become one-click suggestions | `packages/reviewer/src/publish-review.ts`, `render-review.ts` | |
| AI PR REVIEW · NEUTRAL | One check run named "AI PR Review"; its conclusion is neutral when there are findings | `packages/github/src/client.ts` (`CHECK_RUN_NAME`), `packages/reviewer/src/render-check-run.ts` | A clean review concludes "success"; the film shows the findings case |
| NEVER BLOCKS A MERGE | The check run is advisory | `/docs/how-it-works` "It never blocks a merge"; `render-check-run.ts` never returns `failure` for findings | |
| REVIEWS (dashboard tile) | The review is recorded for the dashboard | `apps/worker/src/record-review.ts`, `packages/db/src/ingest.ts` | |
| NOTHING UNCHECKED REACHES YOUR PULL REQUEST | Only validated findings are published | `packages/reviewer/src/review-run.ts` (`validateFindings` before `deliverReview`); the docs page "How it's different" | |
| It can't change your repository | Not on screen; the reviewer's tools are read-only | `tools.ts` | Fix commits (opt-in) are out of frame |

## Layout

192 × 108 cells. Caption zone rows 2–19: the chapter word at 2× (`BIG_X 8`, `BIG_Y 3`) and one or
two 1× lines to its right (`SUB_Y1 3`, `SUB_Y2 11`). Stage rows 22–96. Strip row 100:
`READ PROPOSE CHECK POST`, stone until its chapter, navy after. The small cat (26 × 22) sits at
(10, 60) through READ, PROPOSE, CHECK and POST; the hero mark (50 × 48) opens and closes the film.

| Colour | Role |
|---|---|
| paper `#F5EFE3` | ground |
| sand `#E4DCCC` | card faces |
| navy `#1E2D42` | the cat, ink, captions |
| slate `#4A5B72` | code bars, leaders, rule text |
| stone `#9AA6B8` | faint bars, unlit strip words, the neutral dot |
| turquoise `#3AA693` | nose, whiskers, pass marks, the proven line, FIX buttons, dashboard bars |
| teal `#1D5C5A` | the gate |
| coral `#F47B4E` | pupils, line markers, the cross |
| rust `#C4552C` | dropped-card border and reason |
| mint `#C5E3C7` | added lines |
| amber `#F0B848` | the webhook bolt and the job token |
| white `#FFFFFF` | eye whites |

## Shots (30 fps, beat 15 frames, cel 3 frames)

| # | Chapter | Frames | Caption | What is made, in order |
|---|---|---|---|---|
| 1 | title | 0–105 | LINTCAT · HOW A REVIEW WORKS | Bare paper. The mark is laid in the brand's order: ears, head, inner ears, eyes, pupils, nose, whiskers. The word is typed one glyph per cel, then the cat blinks, looks, and lifts its whiskers. |
| 2 | opened | 105–210 | A PULL REQUEST OPENS · ONE JOB PER HEAD | A PR card draws itself (frame, header, lines, three added). A QUEUE box with three slots. An amber bolt hops from the card to the queue; a job token lands in slot one. The cat pops in as WORKER; the token hops across to it. The strip is typed in stone. |
| 3 | read | 210–390 | READ · 8 READ-ONLY TOOLS · UP TO 12 TURNS | The DIFF page draws; a stone reading cursor sweeps it two lines per cel and leaves the page clean. CONTEXT, BEFORE, IMPORTS and TESTS pages fan out with stone bars; their bars turn navy once read. Pupils follow the pages. |
| 4 | propose | 390–540 | PROPOSE · 6 CANDIDATES | Six finding cards appear one part per cel: frame, label with confidence, text bar, leader to a diff line, a coral marker on that line. Card 3 points at an unchanged line; card 6 repeats card 1's line and gets a second marker beside the first. |
| 5 | check | 540–735 | CHECK · ON A CHANGED LINE · 0.70+ AND UNIQUE → 3 OF 6 SURVIVE | The teal gate draws between the diff and the cards. Each card gets its verdict in five cels. Pass: turquoise border, check mark, its diff line lights turquoise, bar and leader turn turquoise. Fail: rust border, cross, the label replaced by the reason (NOT CHANGED, UNSURE 0.55, DUPLICATE). The survivors' borders pulse, the count is typed, then the dropped cards are erased top to bottom. |
| 6 | post | 735–900 | POST · NEVER BLOCKS A MERGE | A wider PR page with three gaps. Each survivor hops in from the right and becomes an inline comment: avatar, text, a FIX button (two) or NOTE. The AI PR REVIEW badge draws with a stone dot and NEUTRAL; a REVIEWS tile grows three bars. |
| 7 | payoff | 900–1050 | NOTHING UNCHECKED REACHES YOUR PULL REQUEST | The hero mark returns beside the three typed lines; a turquoise rule under PULL REQUEST. From frame 975 the declared hold: loader-style idle (pupils, blinks, whiskers). The GIF loops back to bare paper and the mark redraws: the hook. |

## Checks the film must pass

- `checkTimeline` at module load: shots tile the film on beats; steps are recorded in time order
  and lay at least one op per cel; every non-hold cel changes ≥ 4 cells; every 5-cel window has a
  cel whose change, estimated the way the gate measures it (about 2 px per cell plus a half-cell
  fringe on a 270 × 152 greyscale), reaches 240 px against the gate's 205.
- anidoodle `gate.mjs`: determinism (1 vs 3 pages, reversed order), contract scan, dead air (no
  identical consecutive frames outside the hold, no 15-frame window under 0.5 % changed).
- `check-palette.mjs`: zero off-palette pixels in the GIF and the poster.
- Human pass: a contact sheet (one tile per second), every caption read at 768 px and 360 px wide.
