# Computed-style comparison: this app vs GitHub vs VS Code

Measured 2026-09-21 with `scripts/measure-computed-styles.mjs` (headless Chrome,
1440×900, light scheme). Raw output is in `measurements/*.json`. Re-run with:

```bash
node scripts/measure-computed-styles.mjs ours-map http://localhost:3000/preview/codebase-map
node scripts/measure-computed-styles.mjs github-pulls https://github.com/sunnyeyles/pr-review-agents/pulls
node scripts/measure-computed-styles.mjs vscode https://vscode.dev   # MEASURE_SETTLE_MS=20000
```

Pages: our `/preview/codebase-map` (dashboard shell, sample data) and
`/docs/configuration`; GitHub's repo home, pull-request list and PR #146;
vscode.dev's welcome workspace. Values are medians over visible matches.

## Why it reads smaller

The base is right and the extremities are wrong. Body text is 14px on all
three; buttons are 28/32px on both GitHub and here. What differs:

1. **Prose is 14px; GitHub's is 16px.** Markdown, READMEs, issue bodies and
   docs on GitHub run at 16/24. Our docs run at 14/22.75. That alone is what
   makes the docs feel like a settings panel.
2. **Line-height is 1.43; GitHub's is 1.5.** Tailwind's `text-sm` pairs 14px
   with 20px. Primer pairs 14px with 21px. Every list, cell and paragraph is
   5% tighter than GitHub's.
3. **Headings are two steps down.** GitHub h2 is 24/30; our dashboard section
   titles are 18px and docs h2 is 20px. PR-page h1 on GitHub is 20px, ours is
   30px, so the hierarchy is compressed from both ends.
4. **12px is used for content, not captions.** GitHub uses 12px for labels,
   counters and captions only. We use it for stat hints, eyebrows, table
   captions, toc links, nav links and the codebase map legend.
5. **Every visible button is the small one.** Buttons default to 32px, but
   the shell, page header and toolbars all pass `size="sm"` (28px). GitHub's
   primary actions are 32px; its 28px buttons are the secondary ones in the
   repo header.
6. **The frame is narrower.** Sidebar 208px vs VS Code 300px (GitHub's
   settings/repo sidebars are 256–296px). Content max-width 1184px vs
   GitHub's 1280px container. Topbar 56px vs GitHub's 64px header.

VS Code is the outlier, not the target, for density: 13px type, 22px list
rows, 35px title bar and tabs, 22px icon buttons. It feels bigger than ours
only because its type is set solid and its frame fills the window.

## Type

| Role | Ours (dashboard) | Ours (docs) | GitHub | VS Code |
| --- | --- | --- | --- | --- |
| body | 14 / 20 | 14 / 20 | 14 / 21 | 13 / 18.2 |
| prose paragraph | 12 / 19.5 (stat hints) | 14 / 22.75 | 16 / 24 (markdown), 14 / 21 (UI) | 13 / 18.2 |
| h1 | 30 / 36, 600 | 32 / 40, 600 | 32 / 40, 600 (repo); 20 / 25 (PR title) | 26, 600 |
| h2 | 18 (Section) / 24 (card title) | 20 / 28, 600 | 24 / 30, 600 | 18, 600 |
| muted / secondary | 14 / 20 | 14 / 20 | 12 / 18 or 14 / 21 | 12–13 |
| label, badge, counter | 12 / 16 | 12 / 16 | 12 / 18 | 12 |
| font | system sans | system sans | Mona Sans → system | system |

## Controls

| Role | Ours | GitHub | VS Code |
| --- | --- | --- | --- |
| button medium | 32, pad 0/12, r6 | 32, pad 0/12 (Primer) or 5/16 (btn), r6 | 26, r2 |
| button small | 28, 14px text, pad 0/10 | 28, **12px text**, pad 3/12 | 22 |
| icon button | 28 (icon-sm) | 28 (btn-octicon) | 22, 16px icon |
| text input | 32, pad 4/12, r6 | 32, pad 5/12, r6 | 24–26 |
| select / menu trigger | **36**, pad 8/12 | 28–32 | 26 |
| tab item | 29 in a 36 boxed list | 30 in a 48 underline nav | 35 |
| toggle group item | 32 | 32 (SegmentedControl) | 22 |
| switch | 18.4 tall | 24 (ToggleSwitch) | n/a |
| badge / label | 22, pad 2/8, pill | 20, pad 0/6, pill | 18, pill |
| counter | 22 | 20, r24 | 18 |

## Containers and density

| Role | Ours | GitHub | VS Code |
| --- | --- | --- | --- |
| page gutter | 32 / 24 (sm: 24 / 12) | 24 / 32 (container-xl), 16 top | 0 |
| content max width | 1184 | 1280 | window |
| topbar | 56 | 64 (+8 border/padding) | 35 |
| sidebar width | 208 (dashboard), 240 (docs) | 256–296 | 300 (+44 activity bar) |
| sidebar nav item | 32, pad 6/10, 14px | 32, pad 6/8 (ActionList) | 22 |
| card / Box | r6, pad 16 (Stat) or 24 (default) | r6, header pad 16 | r8 pane |
| card header | 48, pad 0/16 | 55, pad 16 | 22–28 |
| table cell | 37, pad 8 | 41, pad 8/16 (file list); 37, pad 6/13 (markdown) | 22 |
| list row | n/a | 65 (PR list, two lines) | 22 |
| section gap | 48 | 24–32 | 0 |

## Phased revision

Each phase is independently shippable and measured with the script above.

**Phase 0, tokens (this branch).** `--text-body--line-height: 1.5`,
`--text-sm--line-height: 1.5` on body; docs prose to 16/24 with the lede at
18; docs h2 to 24/32, h3 to 20/28. Add `--control-*` heights as Tailwind
spacing tokens so components stop hardcoding `h-8`/`h-9`.

**Phase 1, atoms.** Button: keep 32 default, restrict `size="sm"` to
inline/secondary use, small text to 12px like GitHub. Select trigger to 32.
Badge to 20px with 6px padding. Switch to Primer's 24×48 track. Tabs: add an
`underline` variant (48px nav, 30px items, 2px underline) and make it the
page-level default; keep the boxed variant for in-card toggles. Input: 32
stays. Tooltip and dropdown: Primer overlay shadow, 6px radius.

**Phase 2, molecules.** PageHeader: 32/40 h1 on landing pages, 20/25 on
record pages (a review), eyebrow at 12px only. Section: 24/32 h2, 24px gap
below, 32px between sections. Stat: 32px value, 14px hint, 16px padding.
Table: 40px rows, 8/16 cell padding, 12px semibold uppercase header at 28px.
Sidebar nav: 32px items, 8px padding, 16px icon, group label 12px.
Filter/toolbar row: the pattern in `/preview/codebase-map` (search + scope
select + highlight select + view tabs; kinds + switches + zoom on a second
row) becomes a shared `Toolbar` with 32px controls and 8/16 spacing.

**Phase 3, structure.** Sidebar to 256px on the dashboard; content max
width to 1280px; topbar to 64px; gutters 24/32. Optional VS Code-style
"compact" density flag on the org shell: 13px type, 22px rows, 8px gutters,
for the review and findings pages where the diff is the point.

## The preview route

`/preview/codebase-map` renders the dashboard shell (topbar, sidebar, page
header, stat tiles, a toolbar, a two-pane card) on sample data, with no
database or session. It exists so the phases above can be reviewed on one
page that uses every atom and molecule the dashboard does, and so the
codebase map in issue #145 has a place to grow. The controls set real view
state (the map, kinds, dead files, cycles, search, focus and zoom work); list
and tree views are placeholders. The "what to show" logic is pure and tested
in `apps/web/lib/codebase-map.ts`.
