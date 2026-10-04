---
description: One full tech-debt cycle - discover, plan, execute one ticket, review, update conventions. Stops at the first red gate or REQUEST-CHANGES.
argument-hint: [issue number to execute instead of planning a new one]
---

Run one cycle. Each step is its own command; do not skip or merge them.

1. `/debt-discover`.
2. `/debt-plan 3` unless `$ARGUMENTS` names an issue.
3. Pick one ticket: `$ARGUMENTS`, else the open `tech-debt` + `ready-for-agent` issue with the lowest risk class and the highest-ranked hotspot. One ticket per cycle.
4. `/debt-execute <issue>` (it includes the independent review and, on APPROVE, `/debt-conventions`).
5. Report: the PR URL, the gate deltas, the conventions change (or "none"), and the next ticket you would pick.

Stop conditions, no retries beyond what `/debt-execute` allows: a red gate, a second REQUEST-CHANGES, a ticket whose scope no longer matches the code. A human merges every PR.
