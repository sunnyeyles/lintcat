# packages/design

Stock shadcn/ui (`new-york`, base colour `slate`, Radix primitives, Tailwind
v4). Add or update components with the CLI from inside this package, never by
hand-writing a component or fetching files from GitHub:

```bash
cd packages/design && pnpm dlx shadcn@latest add <component>
```

After every `add`:

- The CLI mis-resolves the `#src/cn` alias and emits `from "cn"`. Rewrite those
  to `#src/cn`, and drop the stray `cn` npm dependency if it reappears in
  `package.json`.
- It still emits `lucide-react` imports. Rewrite them to `#src/icons` (with
  `animate="none"` on primitive indicators) and drop the `lucide-react`
  dependency it adds. `src/tokens-guard.test.ts` fails on any lucide import.
- Re-export anything new from `src/index.ts`.

Icons are Iconsax (`iconsax-reactjs`), wrapped in `src/icons/` with a looping
CSS motion each; apps import them from `@pr-review/design/icons`.

## Colour

Colour comes from `@primer/primitives` (GitHub's tokens), in three layers
(see `docs/adr/0002-primer-tokens-under-shadcn.md`):

1. Primer's `light.css` and `dark.css`, imported by `src/theme.css`. Never
   edited; upgrade the package to move.
2. `src/brand.css`: the only Primer tokens we override — the teal accent
   (`#317a71`), the sand light canvases and the teal dark canvases. Values are
   plain hex, checked by `src/theme.test.ts` for WCAG contrast.
3. `src/theme.css`: shadcn's semantic names (`--background`, `--primary`,
   `--link`, …) aliased onto Primer tokens, plus the Tailwind `@theme` block.
   Components use these names only.

Colour mode is Primer's `data-color-mode` on `<html>`: `auto` follows the OS,
or `light` / `dark` when forced. No `.dark` class, no theme library; Tailwind's
`dark:` variant is a custom one keyed on that attribute. Fonts are the system
stacks.

`src/tokens-guard.test.ts` fails the build on Tailwind palette classes
(`bg-gray-100`) or raw hex in app code.

## Brand

Terminal spinners are in `brand/cli/`; `pnpm spinner` (from the repo root)
demos them. See `brand/README.md`.
