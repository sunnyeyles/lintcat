import type { ChangedFile } from "@pr-review/github";

const QUOTED = /^"((?:[^"\\]|\\.)*)"/;
const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** Octal escapes are single bytes of a UTF-8 path, so decoding waits until every byte is in. */
function unquote(body: string): string {
  const encoder = new TextEncoder();
  const bytes = [...body.matchAll(/\\([0-7]{3}|.)|[^\\]+/gs)].flatMap(([text, escape]) => {
    if (escape === undefined) return [...encoder.encode(text)];
    if (escape.length === 3) return [parseInt(escape, 8)];
    return [C_ESCAPES[escape] ?? escape.charCodeAt(0)];
  });
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** git C-quotes a path holding a quote, a backslash or a control character. */
function pathOf(raw: string): string {
  const quoted = QUOTED.exec(raw);
  return quoted !== null && quoted[0].length === raw.length ? unquote(quoted[1]!) : raw;
}

function withoutPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** git pads a path containing a space with a trailing tab on ---/+++ lines. */
function headerPath(line: string, prefix: string): string | undefined {
  const raw = line.slice(4).replace(/\t$/, "");
  return raw === "/dev/null" ? undefined : withoutPrefix(pathOf(raw), prefix);
}

/** Unquoted paths may hold spaces, so two that differ split only at a lone ` b/`. */
function splitGitLine(line: string): [string, string] | undefined {
  const same = /^(a\/(.+)) (b\/\2)$/.exec(line);
  if (same !== null) return [same[1]!, same[3]!];
  const quoted = QUOTED.exec(line)?.[0];
  if (quoted !== undefined) {
    return line[quoted.length] === " " ? [quoted, line.slice(quoted.length + 1)] : undefined;
  }
  // git quotes any path holding a quote, so a quoted second path starts at the first ` "`.
  const second = line.indexOf(' "');
  if (second >= 0) {
    return [line.slice(0, second), line.slice(second + 1)];
  }
  const splits = line.split(" b/");
  return splits.length === 2 ? [splits[0]!, `b/${splits[1]!}`] : undefined;
}

/** The `diff --git` line's two paths, the only names a mode-only change carries. */
function gitLinePaths(line: string): [string, string] | [undefined, undefined] {
  const split = splitGitLine(line);
  return split === undefined
    ? [undefined, undefined]
    : [withoutPrefix(pathOf(split[0]), "a/"), withoutPrefix(pathOf(split[1]), "b/")];
}

function fileFromChunk(chunk: string): ChangedFile | undefined {
  const lines = chunk.split("\n");
  let [oldPath, newPath] = gitLinePaths(lines[0] ?? "");
  let status = "modified";
  let copied = false;
  let hunkStart = -1;

  for (const [index, line] of lines.entries()) {
    if (line.startsWith("@@")) {
      hunkStart = index;
      break;
    }
    const moved = /^(rename|copy) (from|to) (.+)$/.exec(line);
    if (moved !== null) {
      copied ||= moved[1] === "copy";
      if (moved[2] === "from") oldPath = pathOf(moved[3]!);
      else newPath = pathOf(moved[3]!);
    } else if (line.startsWith("new file mode")) {
      status = "added";
    } else if (line.startsWith("deleted file mode")) {
      status = "removed";
    } else if (line.startsWith("--- ")) {
      oldPath = headerPath(line, "a/") ?? oldPath;
    } else if (line.startsWith("+++ ")) {
      newPath = headerPath(line, "b/") ?? newPath;
    }
  }

  const filename = newPath ?? oldPath;
  if (filename === undefined) {
    return undefined;
  }
  // A copy leaves its source in place, so like GitHub's "copied" it is a change to the new path only.
  const renamed = status === "modified" && !copied && oldPath !== undefined && oldPath !== filename;
  const file: ChangedFile = renamed
    ? { filename, status: "renamed", previous_filename: oldPath, additions: 0, deletions: 0 }
    : { filename, status, additions: 0, deletions: 0 };
  if (hunkStart < 0) {
    return file;
  }

  const hunks = lines.slice(hunkStart);
  while (hunks.length > 0 && hunks[hunks.length - 1] === "") {
    hunks.pop();
  }
  for (const line of hunks) {
    if (line.startsWith("+")) file.additions += 1;
    else if (line.startsWith("-")) file.deletions += 1;
  }
  return { ...file, patch: hunks.join("\n") };
}

/** The diff git would print for a new file, built in-process so no file needs its own `git diff`. */
export function addedFileDiff(file: string, body: Uint8Array): string {
  const header = `diff --git a/${file} b/${file}\nnew file mode 100644\n`;
  if (body.includes(0)) {
    return `${header}Binary files /dev/null and b/${file} differ\n`;
  }
  const text = new TextDecoder().decode(body);
  if (text === "") {
    return header;
  }
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const missingNewline = text.endsWith("\n") ? "" : "\\ No newline at end of file\n";
  const range = lines.length === 1 ? "1" : `1,${lines.length}`;
  return [
    header,
    `--- /dev/null\n+++ b/${file}\n@@ -0,0 +${range} @@\n`,
    ...lines.map((line) => `+${line}\n`),
    missingNewline,
  ].join("");
}

/** Splits `git diff --find-renames` output into GitHub-shaped changed files; `patch` starts at the first hunk. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  return diff
    .split(/^diff --git /m)
    .slice(1)
    .flatMap((chunk) => fileFromChunk(chunk) ?? []);
}
