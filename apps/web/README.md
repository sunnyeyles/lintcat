# @pr-review/web

The dashboard: review history, trends, token spend, and an editor for
`.github/pr-review-agents.yml`.

```bash
pnpm --filter @pr-review/web dev     # http://localhost:3000
```

## It runs on demo data

Nothing writes to Postgres yet. The Action publishes its review to GitHub and
keeps no state, so every figure here comes from a seeded generator in
`lib/data/mock.ts` — same seed, same numbers, every run. A **DEMO DATA** chip
sits in the top bar on every page so this is never mistaken for production.

## The seam

Pages never touch Drizzle. They call `data()`, which returns a `DataSource`:

```ts
import { data } from "@/lib/data";

const reviews = await data().listReviews({ repoId, limit: 20 });
```

`DataSource` (in `lib/data/types.ts`) is the whole contract, and its methods
return Drizzle's own row types from `@pr-review/db`. Pointing the dashboard at
real data means writing one more implementation of that interface and choosing
it in `lib/data/index.ts`; no page changes.

What's missing is upstream of here: something has to populate `reviews`,
`findings` and `agent_runs` in the first place. The likely path is the Action
POSTing its result to a route in this app after it publishes — which keeps
database credentials out of every customer's CI.

## Cost figures

`lib/data/mock.ts` holds a fixed per-million-token price table and derives
every dollar figure from the four token counters. The counters are the shape
the logging events already emit; the prices are illustrative.

## Layout

```text
app/
  page.tsx              overview
  repos/                repo list, and per-repo review history
  reviews/[id]/         one review: summary, agent legs, findings
  analytics/            trends over time
  usage/                tokens and spend
  settings/agents/      agent config editor (emits YAML to copy)
components/
  ui/                   primitives, styled to the docs/index.html palette
  shell/                sidebar, top bar, theme, page header
  charts/               recharts wrappers that follow the theme
lib/
  data/                 the seam above
  format.ts             number, duration and date formatting
  agent-config.ts       pr-review-agents.yml serialisation
```

Theming is a `data-theme` attribute on `<html>` driven by `next-themes`;
colours come from the custom properties in `app/globals.css`, which are lifted
from `docs/index.html` so the dashboard and the project site match.
