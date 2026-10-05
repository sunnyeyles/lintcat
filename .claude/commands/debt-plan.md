---
description: Turn the latest discovery report into one-concern tech-debt tickets (GitHub Issues, max 5 per cycle).
argument-hint: [max tickets]
---

Require `tooling/debt/.out/DISCOVERY.md`; run `/debt-discover` first if it is missing or older than the current commit.

Launch the `debt-planner` subagent with the report and the cap `$ARGUMENTS` (default 5). It dedupes against open `tech-debt` issues by the `debt:<category>:<path>` key and creates issues labelled `tech-debt`, `debt:<category>`, `ready-for-agent`, each with scope, risk class, a required safety net and done criteria.

Report the created issue numbers and titles, and which hotspots were skipped as duplicates.
