# Marrow cloud build

You are a Claude Code cloud session started by `/marrow build`. This checkout is the run branch `marrow-run/<FEATURE>`: marrow is in `.claude/marrow/` and the approved spec and plan are in the feature's run folder, `.marrow/<date>-<FEATURE>/`. The feature itself is built on `marrow/<FEATURE>` in a worktree, so nothing on this run branch reaches it.

Run unattended. Don't ask questions and don't open a PR: the human approves the PR locally with `/marrow publish`.

## 1. Set up

```bash
REPO="$(git rev-parse --show-toplevel)"
MARROW="$REPO/.claude/marrow"
chmod +x "$MARROW"/scripts/*.sh
FDIR="$("$MARROW/scripts/run-dir.sh" find "$REPO" "$FEATURE")"
git fetch origin --prune --quiet
"$MARROW/scripts/approve.sh" "$FDIR" check
```

If the approval check fails, skip to step 4 with `status: "blocked"` and the reason.

Set the git identity from `$FDIR/identity.json` (`git config user.name` and `user.email`, repo-local), so commits carry the developer's name rather than the VM's. If it's empty, use `marrow` and `marrow@users.noreply.github.com`.

## 2. Build the args

```bash
"$MARROW/scripts/build-args.sh" "$REPO" "$FEATURE" "$MARROW" [--lite when LITE=1] > "$FDIR/build-args.json"
```

## 3. Run the workflow

Call the Workflow tool with `scriptPath` `$MARROW/workflows/build.js` (expanded to an absolute path) and `args` set to the parsed contents of `build-args.json`, as a JSON object, not a string. A build can run for hours. If it is killed or the VM is reclaimed, resume it with the same `scriptPath` and args plus `resumeFromRunId`.

## 4. Push the report

Write the workflow's return value into `$FDIR`:

- `report.md`: `Built <date -u>, run <runId>, cloud session.` then `markdown`. If `failures` is set, append `## Red step output` and that file with `cat`.
- `agent-log.md`: `agentLogMarkdown`.
- `pr.md`: `pr.title` as a `# ` heading, a blank line, then `pr.body`. If `pr` is null, write `# <feature>: not ready` and the summary's `why`.
- `ledger.json`: `ledger`.
- `result.json`: `summary`, plus `"run_id"`. If the workflow never ran, write `{"status": "blocked", "why": "<reason>"}` and a short `report.md`.

Also bundle the feature branch, in case the push of `marrow/$FEATURE` was refused (some cloud setups only let a session push its own branch):

```bash
git bundle create "$FDIR/feature.bundle" "marrow/$FEATURE" "^origin/<base branch>" 2>/dev/null || true
```

Then:

```bash
git add -f "$FDIR"
git commit -q -m "marrow: report for $FEATURE"
git push -q origin "HEAD:marrow-run/$FEATURE"
```

`result.json` landing on the run branch is how the local session knows you're done, so push it even when the build failed.

## 5. Finish

End with five lines or fewer: status, checks, open high findings, whether `marrow/<FEATURE>` was pushed, and "Run /marrow publish <FEATURE> locally to open the PR."
