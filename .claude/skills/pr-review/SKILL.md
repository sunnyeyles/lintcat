---
name: pr-review
description: Run the review CI runs on a pull request against the local working tree, then fix, patch or suppress each finding until nothing blocks. Use before pushing or opening a PR, when the user says "review my changes", "run the CI review", "/pr-review", or when the push gate blocked a push.
argument-hint: "[--fail-on low|medium|high] [--base <ref>]"
---

# Local CI review

Runs the same pipeline, policy and validation the worker runs on a pull request, over this checkout's working tree. Findings are already validated; every `patch` in the output is verified against the file byte for byte.

## Run it

From the repository root:

```bash
node apps/cli/start.mjs review --profile ci --format json $ARGUMENTS
```

- stdout is one JSON document; stderr carries progress and the model used. Read stderr for a `Warning:` about the model and pass it on to the user.
- Exit 0: nothing at or above `--fail-on` (default `high`). Exit 1: `blocking` findings remain. Exit 2: the review could not run; report stderr and stop, do not retry. Exit 3: cancelled.
- A repeat over an unchanged tree is answered from the cache (`"cached": true`) and costs nothing.

## Work each finding

Take the findings in the order given. For each one, decide and say which you chose:

1. **Apply the patch** when `patch` is present and you agree with it: replace lines `startLine`..`endLine` of `file`, whose text is exactly `expected`, with `replacement`.
2. **Fix by hand** when the finding is right but has no patch, or the patch is not the fix you want.
3. **Suppress** when it is a false positive here:
   `node apps/cli/start.mjs suppress <id> --reason "<why it is noise in this repo>"`.
   The reason is required in practice: a later reader has only it. Suppressions live in this checkout's local memory. CI does not read them, so the finding is still reported (`"suppressedLocally": true`) and will still appear on the pull request, but it stops blocking here.

Findings below the threshold are advice: mention them, and fix the cheap ones.

## Loop

After changing code, run the review again. Stop when it exits 0, or after three rounds; then list what still blocks and why you left it. Never commit or push as part of this skill; that stays with the user or the task that called it.
