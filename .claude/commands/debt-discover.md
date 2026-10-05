---
description: Run tech-debt discovery (scan, metrics, graph) and write a ranked hotspot report. Read-only.
---

Launch the `debt-discoverer` subagent. It runs `pnpm debt graph`, `pnpm debt scan` and `pnpm debt metrics --all --skip network`, reads `tooling/debt/baseline/` when present, and writes `tooling/debt/.out/DISCOVERY.md`.

When it returns, show the hotspot table and the per-package summary, and name the three tickets you would plan first. Do not plan or fix anything here; that is `/debt-plan` and `/debt-execute`.
