---
description: Independent read-only review of a tech-debt PR (one concern, no behaviour change, API intact, gate green).
argument-hint: <pr number or branch>
---

Launch the `debt-reviewer` subagent on `$ARGUMENTS` in a fresh context. It runs `pnpm debt gate` on the PR head, checks the six rules in its definition, and posts one review with a verdict, findings, the gate tables and a conventions proposal.

Relay the verdict and findings here. Do not fix anything from this command; on REQUEST-CHANGES, the author (or `/debt-execute`) does.
