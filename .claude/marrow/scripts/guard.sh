#!/usr/bin/env bash
# PreToolUse Bash hook for the marrow agents. Reads the hook JSON on stdin.
# Exit 0 allows the command; exit 2 blocks it, with the reason on stderr.
#
# Usage (agent frontmatter, or one repo-level hook with "auto"):
#   guard.sh deny-push     # runner, reviewers, skeptic, judge, planners
#   guard.sh implementer   # deny-push, plus the worktree's file locks
#   guard.sh test-writer   # deny-push, plus edits only to the ticket's test paths
#   guard.sh git-sync      # marrow-git-sync
#   guard.sh auto          # picks the mode from the hook input's agent_type;
#                          # the main session and non-marrow agents pass
#
# deny-push:   no git push, no gh pr merge, no gh api writes, no other gh writes.
# git-sync:    deny-push, except the exact marrow push; also no reset --hard,
#              clean -f, checkout/restore of ".", and branch -D or worktree
#              remove only for marrow branches and worktrees.
# implementer/test-writer: Edit, Write, MultiEdit and NotebookEdit must target
#              a worktree with a <git dir>/marrow-lock.json (see lane.sh lock),
#              or a temp dir, and are checked against that lock. Bash writes
#              get round this; verify-ticket.sh and ledger.sh are the gates.
#
# This is a guardrail against mistakes, not a sandbox: an agent set on getting
# round it (a script file that pushes, say) can.
set -uo pipefail

MODE="${1:-}"
case "$MODE" in
  deny-push|git-sync|implementer|test-writer|auto) ;;
  *)
    echo "guard.sh: unknown mode '${MODE}' (want deny-push, git-sync, implementer, test-writer or auto)" >&2
    exit 2
    ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "guard.sh: python3 is required; blocking to be safe" >&2
  exit 2
fi

python3 -c '
import json
import os
import re
import shlex
import sys

mode = sys.argv[1]

def block(reason, cmd):
    sys.stderr.write(
        "BLOCKED by marrow guard (%s): %s\nCommand: %s\n"
        "The user has not given this agent authority for that. Report it instead of retrying.\n"
        % (mode, reason, cmd))
    sys.exit(2)

try:
    data = json.load(sys.stdin)
except Exception as exc:
    block("could not parse hook input (%s)" % exc, "?")

AUTO = {"marrow-git-sync": "git-sync", "marrow-implementer": "implementer", "marrow-test-writer": "test-writer"}
if mode == "auto":
    agent = data.get("agent_type") or ""
    if not agent.startswith("marrow-"):
        sys.exit(0)
    mode = AUTO.get(agent, "deny-push")

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
tool = data.get("tool_name", "Bash")
tin = data.get("tool_input") or {}

def glob_re(g):
    out, i = "", 0
    while i < len(g):
        if g.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif g.startswith("**", i):
            out += ".*"
            i += 2
        elif g[i] == "*":
            out += "[^/]*"
            i += 1
        elif g[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(g[i])
            i += 1
    return re.compile(out + r"\Z")

def matches(path, globs):
    return any(glob_re(x).match(path) for x in globs)

def lock_for(path):
    """(worktree root, lock dict) for the worktree holding path, or (None, None)."""
    d = os.path.dirname(os.path.abspath(path))
    while d and d != "/":
        dot = os.path.join(d, ".git")
        if os.path.isfile(dot):
            m = re.match(r"gitdir:\s*(.+)", open(dot).read().strip())
            gitdir = m.group(1) if m else ""
            if gitdir and not os.path.isabs(gitdir):
                gitdir = os.path.normpath(os.path.join(d, gitdir))
            lf = os.path.join(gitdir, "marrow-lock.json")
            return (d, json.load(open(lf))) if os.path.isfile(lf) else (d, None)
        if os.path.isdir(dot):
            return (d, None)
        d = os.path.dirname(d)
    return (None, None)

if tool in EDIT_TOOLS:
    if mode not in ("implementer", "test-writer"):
        sys.exit(0)
    path = tin.get("file_path") or tin.get("notebook_path") or ""
    if not path:
        sys.exit(0)
    try:
        root, lock = lock_for(path)
    except Exception as exc:
        block("could not read the worktree lock (%s)" % exc, path)
    if lock is None:
        # Scratch files outside any repo are fine; anything else must be in a locked marrow worktree.
        if root is not None:
            block("%s is in a checkout marrow has not locked for this agent; edit only the worktree in your prompt" % path, path)
        ap = os.path.realpath(os.path.abspath(path))
        tmp = [os.path.realpath(d) for d in ("/tmp", "/private/tmp", os.environ.get("TMPDIR", "/tmp"))]
        if any(ap == d or ap.startswith(d.rstrip("/") + "/") for d in tmp):
            sys.exit(0)
        block("%s is not inside a marrow worktree; edit only the worktree in your prompt" % path, path)
    rel = os.path.relpath(os.path.abspath(path), root)
    if rel.startswith("..") or matches(rel, [".marrow/**", ".claude/**", ".git/**"]):
        block("%s is outside the ticket code" % rel, path)
    if mode == "test-writer":
        allowed = lock.get("tests", []) + lock.get("test_helpers", []) + (lock.get("owns") or [])
        if not matches(rel, allowed):
            block("the test writer may edit only the test paths of the ticket, and stubs in its owned paths %s" % allowed, path)
    else:
        if matches(rel, lock.get("locked", [])):
            block("%s is a locked acceptance test; report a wrong test in notes instead of editing it" % rel, path)
        owns = lock.get("owns") or []
        if owns and not matches(rel, owns):
            block("%s is outside the owned paths of this ticket %s; say so in notes if the ticket needs it" % (rel, owns), path)
    sys.exit(0)

if tool != "Bash":
    sys.exit(0)
cmd = tin.get("command") or ""

SLUG = r"[A-Za-z0-9._-]+"
PATH = r"/[^\s;&|$`\x27\"<>(){}\\]+"

# The only push git-sync may run. The whole command must be exactly this.
PUSH_RE = re.compile(
    r"git -C (?P<path>" + PATH + r") push "
    r"(?:-u|--force-with-lease=marrow/(?P<lease>" + SLUG + r"):[0-9a-f]{40}) "
    r"origin marrow/(?P<branch>" + SLUG + r")")

def allowed_push(text):
    m = PUSH_RE.fullmatch(text.strip())
    if not m:
        return False
    if m.group("lease") and m.group("lease") != m.group("branch"):
        return False
    return "/.claude/worktrees/marrow-" in m.group("path")

def find_close(s, i):
    # s[i] is the char after "$(" ; return the index of the matching ")".
    depth, q = 1, None
    while i < len(s):
        c = s[i]
        if q:
            if c == q:
                q = None
            elif c == "\\" and q == "\"":
                i += 1
        elif c in "\x27\"":
            q = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(s)

def split_segments(s):
    """Split on unquoted ; & | newline ( ) { }, and pull out $(...) and backticks."""
    segs, cur, i, q = [], [], 0, None
    def flush():
        seg = "".join(cur).strip()
        if seg:
            segs.append(seg)
        cur.clear()
    while i < len(s):
        c = s[i]
        if q == "\x27":
            cur.append(c)
            if c == "\x27":
                q = None
            i += 1
            continue
        if c == "\\" and i + 1 < len(s):
            cur.append(s[i:i + 2])
            i += 2
            continue
        if s.startswith("$(", i):
            end = find_close(s, i + 2)
            segs.extend(split_segments(s[i + 2:end]))
            cur.append("SUBST")
            i = end + 1
            continue
        if c == "`":
            end = s.find("`", i + 1)
            end = len(s) if end < 0 else end
            segs.extend(split_segments(s[i + 1:end]))
            cur.append("SUBST")
            i = end + 1
            continue
        if q == "\"":
            cur.append(c)
            if c == "\"":
                q = None
            i += 1
            continue
        if c in "\x27\"":
            q = c
            cur.append(c)
            i += 1
            continue
        if c in ";&|\n(){}":
            flush()
            i += 1
            continue
        cur.append(c)
        i += 1
    flush()
    return segs

KEYWORDS = {"then", "do", "else", "elif", "if", "while", "until", "!"}
# Commands that run the rest of the line, and their options that take a value.
ARG_OPTS = {
    "env": {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"},
    "xargs": {"-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"},
    "timeout": {"-s", "--signal", "-k", "--kill-after"},
    "nice": {"-n"},
    "command": set(),
    "builtin": set(),
    "nohup": set(),
    "exec": {"-a"},
    "time": {"-f", "--format", "-o", "--output"},
    "sudo": {"-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C",
             "--close-from", "-D", "--chdir", "-r", "--role", "-t", "--type", "-U",
             "--other-user", "-T", "--command-timeout"},
    "doas": {"-u", "-C"},
    "caffeinate": {"-t", "-w"},
    "stdbuf": {"-i", "-o", "-e"},
}

def takes_value(opt, opts):
    """True when opt consumes the next word, including a short-option cluster like -iu."""
    if opt in opts:
        return True
    if opt.startswith("--") or "=" in opt:
        return False
    for k, ch in enumerate(opt[1:], 1):
        if "-" + ch in opts:
            return k == len(opt) - 1
    return False
GIT_ARG_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace",
                "--exec-path", "--config-env", "--super-prefix"}
SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}

def commands(text, depth=0):
    """Yield (head, words) for every simple command, unwrapping sh -c and eval."""
    if depth > 4:
        yield ("?", ["unparseable nesting"])
        return
    for seg in split_segments(text):
        try:
            words = shlex.split(seg, posix=True)
        except ValueError:
            yield ("?raw", [seg])
            continue
        while words:
            w = words[0]
            base = os.path.basename(w)
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w) or base in KEYWORDS:
                words = words[1:]
                continue
            if base in ARG_OPTS:
                words = words[1:]
                while words and words[0].startswith("-"):
                    opt = words[0]
                    words = words[1:]
                    if base == "env" and (opt in ("-S", "--split-string") or opt.startswith("--split-string=")):
                        split = opt.split("=", 1)[1] if "=" in opt else (words[0] if words else "")
                        yield from commands(split, depth + 1)
                    if takes_value(opt, ARG_OPTS[base]) and words:
                        words = words[1:]
                while base == "env" and words and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", words[0]):
                    words = words[1:]
                if base == "timeout" and words:
                    words = words[1:]
                continue
            break
        if not words:
            continue
        head = os.path.basename(words[0])
        if head in SHELLS:
            for j, w in enumerate(words[1:], 1):
                if re.match(r"^-[A-Za-z]*c[A-Za-z]*$", w) and j + 1 < len(words):
                    yield from commands(words[j + 1], depth + 1)
                    break
            yield (head, words)
            continue
        if head == "eval":
            yield from commands(" ".join(words[1:]), depth + 1)
            continue
        yield (head, words)

def git_parts(words):
    """Return (global_opts, subcommand, args) for a git command."""
    opts, i = [], 1
    while i < len(words) and words[i].startswith("-"):
        w = words[i]
        opts.append(w)
        if w in GIT_ARG_OPTS and i + 1 < len(words):
            opts.append(words[i + 1])
            i += 1
        i += 1
    sub = words[i] if i < len(words) else ""
    return opts, sub, words[i + 1:]

GH_WRITE_VERBS = {"create", "merge", "close", "edit", "delete", "ready", "reopen",
                  "comment", "review", "lock", "unlock", "transfer", "archive",
                  "unarchive", "rename", "sync", "fork", "set", "remove", "add",
                  "upload", "enable", "disable", "run", "cancel", "rerun", "revert",
                  "pin", "unpin", "develop", "update-branch", "clone"}

# gh flags that take a value, so the value is not read as the group or verb
GH_VALUE_FLAGS = {"-R", "--repo", "--hostname", "-t", "--title", "-b", "--body",
                  "-F", "--body-file", "-B", "--base", "-H", "--head", "-l", "--label",
                  "-a", "--assignee", "-r", "--reviewer", "-m", "--milestone",
                  "-p", "--project", "-T", "--template", "-q", "--jq", "-L", "--limit",
                  "-s", "--state", "-A", "--author", "-S", "--search"}

def gh_api_writes(args):
    method, fields = None, False
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-X", "--method") and i + 1 < len(args):
            method = args[i + 1].upper()
            i += 1
        elif a.startswith("--method="):
            method = a.split("=", 1)[1].upper()
        elif a.startswith("-X") and len(a) > 2:
            method = a[2:].upper()
        elif a in ("-f", "-F", "--field", "--raw-field", "--input") or \
                a.startswith(("--field=", "--raw-field=", "--input=")) or \
                re.match(r"^-[fF].+", a):
            fields = True
        i += 1
    if method is None:
        return fields
    return method != "GET"

def check(head, words, whole):
    raw = " ".join(words)
    if head == "?":
        block("command nests shells too deeply to check", whole)
    if head == "?raw":
        # Unbalanced quotes: fall back to a plain text match.
        if re.search(r"\bgit\b.*\b(push|send-pack)\b", words[0]) or re.search(r"\bgh\b.*\b(merge|api)\b", words[0]):
            block("could not parse this command, and it looks like a push, merge or API call", whole)
        return
    if head == "git":
        opts, sub, args = git_parts(words)
        for j, o in enumerate(opts):
            val = None
            if o in ("-c", "--config-env") and j + 1 < len(opts):
                val = opts[j + 1]
            elif o.startswith("--config-env="):
                val = o.split("=", 1)[1]
            if val is not None and val.lower().startswith("alias."):
                block("git %s alias.* can hide a push" % o.split("=")[0], whole)
        reads = {"--get", "--get-all", "--get-regexp", "-l", "--list"}
        is_read = reads.intersection(args) or args[:1] in (["get"], ["list"])
        if sub == "config" and not is_read and any(a.lower().startswith("alias.") for a in args):
            block("setting a git alias can hide a push", whole)
        if (sub == "subtree" and "push" in args) or (sub == "lfs" and "push" in args) or \
                (sub == "svn" and "dcommit" in args) or (sub == "p4" and "submit" in args):
            block("git %s can push to a remote" % sub, whole)
        if sub in ("push", "send-pack"):
            if mode == "git-sync":
                block("the only push allowed is exactly "
                      "`git -C <marrow worktree> push (-u|--force-with-lease=marrow/<f>:<sha>) origin marrow/<f>`, "
                      "run on its own with nothing chained", whole)
            block("git push is not allowed for this agent", whole)
        if mode == "git-sync":
            if sub == "reset" and "--hard" in args:
                block("git reset --hard is not allowed", whole)
            if sub == "clean" and any(re.match(r"^-[a-zA-Z]*f", a) or a == "--force" for a in args):
                block("git clean -f is not allowed", whole)
            if sub in ("checkout", "restore") and "." in args:
                block("git %s . is not allowed" % sub, whole)
            if sub == "branch":
                force_delete = any(re.match(r"^-[a-zA-Z]*D", a) for a in args) or (
                    any(a in ("-d", "--delete") for a in args) and any(a in ("-f", "--force") for a in args))
                if force_delete:
                    names = [a for a in args if not a.startswith("-")]
                    if not names or not all(re.fullmatch(r"marrow/" + SLUG, n) for n in names):
                        block("git branch -D is allowed only for marrow/* branches", whole)
            if sub == "worktree" and args[:1] == ["remove"]:
                paths = [a for a in args[1:] if not a.startswith("-")]
                if not paths or not all("/.claude/worktrees/marrow-" in p for p in paths):
                    block("git worktree remove is allowed only for .claude/worktrees/marrow-*", whole)
            if sub == "update-ref" and "-d" in args:
                block("git update-ref -d is not allowed", whole)
    if head == "gh":
        pos, k = [], 1
        while k < len(words):
            w = words[k]
            if w.startswith("-"):
                if w in GH_VALUE_FLAGS:
                    k += 1
            else:
                pos.append(w)
            k += 1
        group = pos[0] if pos else ""
        verb = pos[1] if len(pos) > 1 else ""
        if group == "pr" and verb == "merge":
            block("gh pr merge is not allowed; the human merges", whole)
        if group == "api":
            if gh_api_writes(words[2:]):
                block("gh api writes are not allowed (use -X GET for reads)", whole)
            return
        if group in ("auth", "help", "version", "status", "search", "browse"):
            return
        if verb in GH_WRITE_VERBS:
            block("gh %s %s is a write this agent may not make" % (group, verb), whole)

if mode == "git-sync" and allowed_push(cmd):
    sys.exit(0)

# GIT_CONFIG_KEY_<n> and GIT_CONFIG_PARAMETERS set config, aliases included, from the environment.
if re.search(r"GIT_CONFIG_(?:KEY_\d+|PARAMETERS)=\S*alias\.", cmd, re.I):
    block("git config from the environment can define an alias that hides a push", cmd)

for head, words in commands(cmd):
    check(head, words, cmd)

sys.exit(0)
' "$MODE"
rc=$?
# Fail closed: a crash (exit 1) would otherwise let the command through.
if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  echo "guard.sh: checker crashed (exit $rc); blocking to be safe" >&2
  exit 2
fi
exit "$rc"
