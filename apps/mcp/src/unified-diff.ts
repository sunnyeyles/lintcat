import type { ChangedFile } from "@pr-review/github";

/** git pads a path containing a space with a trailing tab on ---/+++ lines. */
function headerPath(line: string, prefix: string): string | undefined {
  const raw = line.slice(4).replace(/\t$/, "");
  if (raw === "/dev/null") {
    return undefined;
  }
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function fileFromChunk(chunk: string): ChangedFile | undefined {
  const lines = chunk.split("\n");
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let status = "modified";
  let hunkStart = -1;

  for (const [index, line] of lines.entries()) {
    if (line.startsWith("@@")) {
      hunkStart = index;
      break;
    }
    if (line.startsWith("new file mode")) {
      status = "added";
    } else if (line.startsWith("deleted file mode")) {
      status = "removed";
    } else if (line.startsWith("--- ")) {
      oldPath = headerPath(line, "a/");
    } else if (line.startsWith("+++ ")) {
      newPath = headerPath(line, "b/");
    } else if (line.startsWith("Binary files ")) {
      const match = /^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+?)|\/dev\/null) differ$/.exec(line);
      oldPath = match?.[1];
      newPath = match?.[2];
    }
  }

  // A mode-only change carries no ---/+++ lines; its path is in the first line.
  const filename =
    newPath ?? oldPath ?? /^a\/(.+) b\/\1$/.exec(lines[0] ?? "")?.[1];
  if (filename === undefined) {
    return undefined;
  }
  if (hunkStart < 0) {
    return { filename, status, additions: 0, deletions: 0 };
  }

  const hunks = lines.slice(hunkStart);
  while (hunks.length > 0 && hunks[hunks.length - 1] === "") {
    hunks.pop();
  }
  let additions = 0;
  let deletions = 0;
  for (const line of hunks) {
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { filename, status, additions, deletions, patch: hunks.join("\n") };
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

/** Splits `git diff` output into GitHub-shaped changed files; `patch` starts at the first hunk. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  return diff
    .split(/^diff --git /m)
    .slice(1)
    .flatMap((chunk) => fileFromChunk(chunk) ?? []);
}
