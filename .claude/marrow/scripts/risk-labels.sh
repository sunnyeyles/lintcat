#!/usr/bin/env bash
# Work out a branch's deploy-risk labels from fixed rules over its diff, so the
# PR says what a human must do before it deploys.
#
# Usage:
#   risk-labels.sh <worktree or repo> <base> <head>
#
# Only lines the diff adds count; an env var or secret also removed elsewhere
# in the diff moved, so it isn't new. Labels:
#   needs-env              a new env var read in non-test code (process.env,
#                          import.meta.env, os.Getenv, os.environ, ENV[...],
#                          env::var, System.getenv, envconfig), set in a
#                          .env* file, or listed in compose or k8s YAML
#   needs-secret           a new secretKeyRef name, --set-secrets entry,
#                          gcloud secrets create, or secrets.X in a GitHub workflow
#   db-migration           an added or changed file under migrations/,
#                          migration/, db/migrate/ or alembic/versions/
#   destructive-migration  DROP TABLE/COLUMN/SCHEMA, RENAME, ALTER COLUMN TYPE,
#                          TRUNCATE, DELETE FROM, or an ORM drop, remove or
#                          rename, in a migration that isn't a .down file
# Prints {"ok": true, "labels": [{name, color, description, items: [{key,
# file, note?}]}]}, sorted by name. Exit 0 listed (maybe none), 1 failed, 2 on misuse.
set -uo pipefail

WT="${1:-}" BASE="${2:-}" HEAD="${3:-}"
if [[ -z "$WT" || -z "$BASE" || -z "$HEAD" ]]; then
  echo "usage: risk-labels.sh <worktree> <base> <head>" >&2
  exit 2
fi
command -v python3 >/dev/null || { jq -n '{ok: false, error: "python3 is needed"}'; exit 1; }

python3 -I - "$WT" "$BASE" "$HEAD" <<'PY'
import json, re, subprocess, sys

wt, base, head = sys.argv[1:4]
p = subprocess.run(["git", "-C", wt, "diff", "-U0", "-M", "--no-color", "--no-ext-diff", f"{base}...{head}"],
                   capture_output=True, text=True, errors="replace")
if p.returncode != 0:
    print(json.dumps({"ok": False, "error": p.stderr.strip()[-500:] or "git diff failed"}))
    sys.exit(1)

# (file, line) for every added and removed line; files is each changed path on the new side.
added, removed, files = [], [], set()
old = new = None
header = False  # between "diff --git" and the first "@@", where ---/+++ name the files
for line in p.stdout.splitlines():
    if line.startswith("diff --git "):
        header, old, new = True, None, None
    elif line.startswith("@@"):
        header = False
    elif header and line.startswith("--- "):
        old = None if line == "--- /dev/null" else line[6:]
    elif header and line.startswith("+++ "):
        new = None if line == "+++ /dev/null" else line[6:]
        if new:
            files.add(new)
    elif header:
        continue
    elif line.startswith("+") and new:
        added.append((new, line[1:]))
    elif line.startswith("-") and old:
        removed.append((old, line[1:]))

NAME = r"([A-Z][A-Z0-9_]*)"
Q = r"[\"']"
TEST = re.compile(r"\.(test|spec)\.|_test\.(go|py)$|(^|/)test_[^/]*\.py$|(^|/)(tests?|__tests__|e2e)/")
ENV_CODE = [re.compile(x) for x in (
    rf"process\.env\.{NAME}", rf"process\.env\[{Q}{NAME}{Q}\]", rf"import\.meta\.env\.{NAME}",
    rf"os\.(?:Getenv|LookupEnv)\(\"{NAME}\"\)", rf"envconfig:\"{NAME}\"",
    rf"os\.environ\[{Q}{NAME}{Q}\]", rf"os\.environ\.get\({Q}{NAME}{Q}", rf"os\.getenv\({Q}{NAME}{Q}",
    rf"\bENV\[{Q}{NAME}{Q}\]", rf"\bENV\.fetch\({Q}{NAME}{Q}", rf"env::var(?:_os)?\(\"{NAME}\"\)",
    rf"System\.getenv\(\"{NAME}\"\)")]
ENV_FILE = re.compile(r"(^|/)\.env[^/]*$")
COMPOSE = re.compile(r"(^|/)(docker-)?compose[^/]*\.ya?ml$")
YAML = re.compile(r"\.ya?ml$")
ALWAYS_SET = {"NODE_ENV", "NEXT_PHASE", "NEXT_RUNTIME", "CI", "HOME", "PATH", "PWD", "GITHUB_TOKEN"}
MIGRATION = re.compile(r"(^|/)(migrations?|db/migrate|alembic/versions)/")
DESTRUCTIVE_SQL = re.compile(r"DROP\s+(TABLE|COLUMN|SCHEMA)\b|(^|[^A-Z_])RENAME([^A-Z_]|$)|ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b|(^|[^A-Z_])TRUNCATE([^A-Z_]|$)|DELETE\s+FROM\b")
DESTRUCTIVE_ORM = re.compile(r"\b(drop_table|remove_column|rename_column|rename_table|dropTable|dropColumn|renameColumn|renameTable)\b|\bop\.drop_")

def env_names(rows):
    out = {}
    for f, l in rows:
        names = []
        if ENV_FILE.search(f):
            m = re.match(rf"\s*(?:export\s+)?{NAME}=", l)
            names = [m.group(1)] if m else []
        elif YAML.search(f) and not f.startswith(".github/"):
            m = re.match(rf"\s*-\s*name:\s*{Q}?{NAME}{Q}?\s*$", l)
            if not m and COMPOSE.search(f):
                m = re.match(rf"\s+{NAME}:\s", l) or re.match(rf"\s+-\s*{NAME}=", l)
            names = [m.group(1)] if m else []
        elif not TEST.search(f):
            names = [m.group(1) for r in ENV_CODE for m in r.finditer(l)]
        for n in names:
            if n not in ALWAYS_SET:
                out.setdefault(n, f)
    return out

def secret_names(rows):
    out, ref = {}, set()
    for f, l in rows:
        if "secretKeyRef:" in l:
            ref.add(f)
            continue
        m = re.match(r"\s*name:\s*[\"']?([^\"'\s]+)", l)
        if f in ref and m:
            out.setdefault(m.group(1), f)
            ref.discard(f)
            continue
        if "--set-secrets" in l:
            for tok in re.split(r"[\s=,]+", l):
                if re.search(r":(latest|\d+)$", tok):
                    out.setdefault(tok.split(":")[0], f)
        m = re.search(r"gcloud secrets create\s+[\"']?([^\s\"'\\]+)", l)
        if m:
            out.setdefault(m.group(1), f)
        if f.startswith(".github/workflows/"):
            for m in re.finditer(r"\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}", l):
                out.setdefault(m.group(1), f)
    return {k: v for k, v in out.items() if not k.startswith("$") and k not in ALWAYS_SET}

labels = {}
def label(name, items):
    if items:
        labels[name] = items

env_rm = env_names(removed)
label("needs-env", [{"key": n, "file": f} for n, f in sorted(env_names(added).items()) if n not in env_rm])
sec_rm = secret_names(removed)
label("needs-secret", [{"key": n, "file": f} for n, f in sorted(secret_names(added).items()) if n not in sec_rm])

migrations = sorted(f for f in files if MIGRATION.search(f))
items = []
for f in migrations:
    item = {"key": f, "file": f}
    if re.search(r"\.up\.sql$", f) and re.sub(r"\.up\.sql$", ".down.sql", f) not in files:
        item["note"] = "no matching .down.sql in this diff"
    items.append(item)
label("db-migration", items)

items = []
for f, l in added:
    if not MIGRATION.search(f) or ".down." in f:
        continue
    code = re.sub(r"--.*|^\s*(#|//).*", "", l)
    if DESTRUCTIVE_SQL.search(code.upper()) or DESTRUCTIVE_ORM.search(code):
        items.append({"key": code.strip()[:160], "file": f})
label("destructive-migration", items)

META = {
    "needs-env": ("FBCA04", "Set new environment variables before this deploys"),
    "needs-secret": ("D93F0B", "Create new secrets before this deploys"),
    "db-migration": ("1D76DB", "Adds or changes a database migration"),
    "destructive-migration": ("000000", "Migration drops or rewrites data; the release that stopped using it must be in prod"),
}
print(json.dumps({"ok": True, "labels": [
    {"name": n, "color": META[n][0], "description": META[n][1], "items": labels[n]} for n in sorted(labels)]}))
PY
