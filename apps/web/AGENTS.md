# apps/web

Import with `@/`, not `#src/`. Layout, environment and deploys are in
`README.md`.

## Data and access

Pages never touch Drizzle. They read through `data(slug)` from
`lib/data/server.ts`, which scopes every query to the repos `authorize` let the
viewer into, so another organization's row is a 404. Organization pages are
guarded by `requireOrganization`, repository pages by `requireRepo`
(`lib/session.ts`). See "The seam" in `README.md`.

## Colour mode and brand

The topbar toggle (`components/shell/color-mode-toggle.tsx`) sets
`data-color-mode` to `light` or `dark`, persisted in `localStorage` and restored
by an inline script before paint. Tokens and the `dark:` variant are in
`packages/design/AGENTS.md`.

Brand assets (the LintCat mark and lockup, colour and mono, and the animated
loaders) live in `public/brand/`. `components/shell/logo-mark.tsx` draws the
same mark from the `--brand-*` tokens for inline use, with `animate="hover"`
(the topbar) or `animate="always"` (a loading state).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
