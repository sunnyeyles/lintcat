#!/usr/bin/env bash
# Check a feature's plan.json against its spec and work out the build waves.
# No model judgement: shape, ids, coverage, dependencies and file ownership.
#
# Usage:
#   plan-check.sh <feature-dir>              # JSON on stdout
#   plan-check.sh <feature-dir> --markdown   # the plan as Markdown, for review
#
# plan.json:
#   { "feature": "...",
#     "criteria": [{"id": "AC1", "text": "...", "verify": "auto|manual"}],
#     "tickets": [{"id": "01", "title": "...", "goal": "...", "criteria": ["AC1"],
#                  "blocked_by": [], "owns": ["src/api/**"],
#                  "tests": {"paths": ["src/api/x.test.ts"], "helpers": [], "command": "..."},
#                  "difficulty": "normal|hard", "steps": ["..."], "human_steps": [], "notes": ""}] }
#
# Every criterion id must appear in spec.md, and every auto criterion must be
# covered by a ticket. A ticket with auto criteria needs test paths and a test
# command. Waves are dependency layers; two tickets whose owned, test or
# helper paths may overlap never share a wave (the later one moves down, with
# a warning). An optional top-level "lanes" (1-3, default 3) caps parallel
# tickets, for repos whose tests share a database or ports.
# Exit 0 when ok, 1 with "errors", 2 on misuse.
set -euo pipefail

FDIR="${1:-}"
MODE="${2:-json}"
if [[ -z "$FDIR" || ! -d "$FDIR" || ( "$MODE" != json && "$MODE" != --markdown ) ]]; then
  echo "usage: plan-check.sh <feature-dir> [--markdown]" >&2
  exit 2
fi
export FDIR MODE

python3 - <<'PY'
import json
import os
import re
import sys

fdir, mode = os.environ["FDIR"], os.environ["MODE"]
errors, warnings = [], []

def done():
    out = {"ok": not errors, "errors": errors, "warnings": warnings, "waves": waves if not errors else []}
    print(json.dumps(out, indent=2))
    sys.exit(0 if not errors else 1)

waves = []
try:
    plan = json.load(open(os.path.join(fdir, "plan.json")))
except Exception as exc:
    errors.append("cannot read plan.json: %s" % exc)
    done()
try:
    spec = open(os.path.join(fdir, "spec.md"), encoding="utf-8").read()
except Exception as exc:
    errors.append("cannot read spec.md: %s" % exc)
    spec = ""

spec_ids = set(re.findall(r"\b(AC\d+)\b", spec))
criteria = {c.get("id"): c for c in plan.get("criteria", [])}
for cid, c in criteria.items():
    if not cid or not re.fullmatch(r"AC\d+", cid):
        errors.append("bad criterion id %r" % cid)
    elif cid not in spec_ids:
        errors.append("criterion %s is not in spec.md" % cid)
    if c.get("verify", "auto") not in ("auto", "manual"):
        errors.append("criterion %s: verify must be auto or manual" % cid)
for sid in sorted(spec_ids - set(criteria)):
    errors.append("spec criterion %s is missing from plan.json" % sid)

tickets = {}
for t in plan.get("tickets", []):
    tid = t.get("id", "")
    if not re.fullmatch(r"\d{2,3}", tid):
        errors.append("bad ticket id %r (want 01, 02, ...)" % tid)
        continue
    if tid in tickets:
        errors.append("two tickets numbered %s" % tid)
    tickets[tid] = t
if not tickets:
    errors.append("no tickets")
    done()

covered = set()
for tid, t in tickets.items():
    for k in ("title", "goal"):
        if not str(t.get(k, "")).strip():
            errors.append("ticket %s has no %s" % (tid, k))
    for cid in t.get("criteria", []):
        if cid not in criteria:
            errors.append("ticket %s names unknown criterion %s" % (tid, cid))
        covered.add(cid)
    for b in t.get("blocked_by", []):
        if b not in tickets:
            errors.append("ticket %s is blocked by %s, which doesn't exist" % (tid, b))
    if not t.get("owns"):
        errors.append("ticket %s owns no paths" % tid)
    if t.get("difficulty", "normal") not in ("normal", "hard"):
        errors.append("ticket %s: difficulty must be normal or hard" % tid)
    auto = [c for c in t.get("criteria", []) if criteria.get(c, {}).get("verify", "auto") == "auto"]
    tests = t.get("tests") or {}
    if auto and not (tests.get("paths") and str(tests.get("command", "")).strip()):
        errors.append("ticket %s covers %s but has no test paths or test command" % (tid, ", ".join(auto)))
    for p in tests.get("paths", []):
        if any(ch in p for ch in "*?["):
            errors.append("ticket %s: test path %r must be a file, not a glob" % (tid, p))

if plan.get("lanes", 3) not in (1, 2, 3):
    errors.append("lanes must be 1, 2 or 3")
for cid, c in criteria.items():
    if c.get("verify", "auto") == "auto" and cid not in covered:
        errors.append("criterion %s is covered by no ticket" % cid)

def prefix(g):
    m = re.search(r"[*?\[]", g)
    return g[:m.start()] if m else g

def overlap(a, b):
    for x in a:
        for y in b:
            px, py = prefix(x), prefix(y)
            exact_x, exact_y = px == x, py == y
            if exact_x and exact_y:
                if x == y:
                    return (x, y)
            elif exact_x:
                if x.startswith(py):
                    return (x, y)
            elif exact_y:
                if y.startswith(px):
                    return (x, y)
            elif px.startswith(py) or py.startswith(px):
                return (x, y)
    return None

# Dependency layers, then split any layer whose tickets may touch the same files.
level, stack = {}, set()
def depth(tid):
    if tid in level:
        return level[tid]
    if tid in stack:
        errors.append("blocking cycle through ticket %s" % tid)
        return 0
    stack.add(tid)
    d = 0
    for b in tickets[tid].get("blocked_by", []):
        if b in tickets:
            d = max(d, depth(b) + 1)
    stack.discard(tid)
    level[tid] = d
    return d
for tid in sorted(tickets):
    depth(tid)
if errors:
    done()

def touches(t):
    tests = t.get("tests") or {}
    return list(t.get("owns", [])) + list(tests.get("paths", [])) + list(tests.get("helpers", []))

pending = sorted(tickets, key=lambda x: (level[x], x))
placed = {}
for tid in pending:
    w = max([placed[b] + 1 for b in tickets[tid].get("blocked_by", [])] + [0])
    while True:
        while len(waves) <= w:
            waves.append([])
        clash = next((o for o in waves[w] if overlap(touches(tickets[tid]), touches(tickets[o]))), None)
        if not clash:
            break
        warnings.append("tickets %s and %s may touch the same files (%s vs %s); %s runs after %s"
                        % (clash, tid, *overlap(touches(tickets[tid]), touches(tickets[clash])), tid, clash))
        w += 1
    waves[w].append(tid)
    placed[tid] = w
waves = [w for w in waves if w]

if mode == "--markdown":
    md = ["# Plan: %s" % plan.get("feature", os.path.basename(fdir)), ""]
    md.append("Waves (tickets in a wave run in parallel): " + " → ".join("[" + ", ".join(w) + "]" for w in waves))
    md.append("")
    md.append("## Acceptance criteria")
    md.append("")
    for cid in sorted(criteria, key=lambda x: int(x[2:])):
        c = criteria[cid]
        by = [t for t in sorted(tickets) if cid in tickets[t].get("criteria", [])]
        md.append("- **%s** (%s, %s): %s" % (cid, c.get("verify", "auto"), ", ".join(by) or "no ticket", c.get("text", "")))
    md.append("")
    md.append("## Tickets")
    for tid in sorted(tickets):
        t = tickets[tid]
        md.append("")
        md.append("### %s. %s%s" % (tid, t["title"], " (hard: two attempts, judged)" if t.get("difficulty") == "hard" else ""))
        md.append("")
        md.append(t["goal"])
        md.append("")
        md.append("- Criteria: %s" % (", ".join(t.get("criteria", [])) or "none"))
        md.append("- Blocked by: %s" % (", ".join(t.get("blocked_by", [])) or "none"))
        md.append("- Owns: %s" % ", ".join("`%s`" % p for p in t["owns"]))
        tests = t.get("tests") or {}
        if tests.get("paths"):
            md.append("- Tests: %s, run with `%s`" % (", ".join("`%s`" % p for p in tests["paths"]), tests.get("command", "")))
        for s in t.get("steps", []):
            md.append("  - [ ] %s" % s)
        for h in t.get("human_steps", []):
            md.append("- Human step: %s" % h)
        if t.get("notes"):
            md.append("- Notes: %s" % t["notes"])
    if warnings:
        md += ["", "## Warnings", ""] + ["- %s" % w for w in warnings]
    print("\n".join(md))
    sys.exit(0)

done()
PY
