# evals

`pnpm eval` runs the real pipeline on a real model and spends real tokens. It
needs a provider key and refuses to start without one. Don't run it unasked.

```bash
MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-5 pnpm eval
```

- `src/**/*.eval.ts` is the paid suite (`vitest.eval.config.ts`).
- `*.test.ts` here cover the harness itself and run in `pnpm test`, with no
  model.
- `retry: 0` and serial fixtures are deliberate: a retry would hide a flaky
  reviewer, and interleaved reviews make the report unreadable.

What is evaluated, known gaps, and adding a fixture: `README.md`.
