/** Doc links a pull request adds that point at nothing: checked in code, reported as findings. */
import type { ChangedFile } from "@pr-review/github";
import {
  isDocPath,
  patchLines,
  readDoc,
  resolveDocLink,
  type RepositoryIndex,
} from "@pr-review/index";
import type { ReviewFinding } from "@pr-review/schemas";

import { MAX_FINDINGS } from "#src/validate-findings";

interface DocLinkCheck {
  /** The base index; without one, only targets the pull request itself touches are checked. */
  index: RepositoryIndex | undefined;
  /** The files whose added lines are checked. */
  scope: readonly ChangedFile[];
  /** Every file the pull request changes, which decides what exists at head. */
  pullRequest: readonly ChangedFile[];
  /** A file's contents at head; throws when it cannot be read. */
  readHead: (path: string) => Promise<string>;
}

const LINE_ANCHOR = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/;
const MAX_NAMED_HEADINGS = 8;

/** Whether a path is a file or directory at head; undefined when the index cannot say. */
function headExistence(index: RepositoryIndex | undefined, files: readonly ChangedFile[]) {
  const present = new Set(files.filter((file) => file.status !== "removed").map((file) => file.filename));
  const gone = new Set(
    files.flatMap((file) =>
      file.status === "removed"
        ? [file.filename]
        : file.previous_filename === undefined
          ? []
          : [file.previous_filename],
    ),
  );
  const under = (paths: Iterable<string>, directory: string): boolean => {
    for (const path of paths) {
      if (path.startsWith(`${directory}/`) && !gone.has(path)) return true;
    }
    return false;
  };
  return (path: string): boolean | undefined => {
    if (path === "" || present.has(path) || under(present, path)) return true;
    if (gone.has(path)) return false;
    if (index === undefined) return undefined;
    if (index.files.has(path) || under(index.files.keys(), path)) return true;
    return index.truncated ? undefined : false;
  };
}

function missingFile(file: string, line: number, target: string, path: string): ReviewFinding {
  return {
    file,
    line,
    category: "docs",
    severity: "low",
    title: `Link to ${path} points at a file that does not exist`,
    explanation: `\`${target}\` resolves to \`${path}\`, which is not in the repository at this pull request's head.`,
    confidence: 1,
  };
}

function missingAnchor(
  file: string,
  line: number,
  target: string,
  path: string,
  anchors: readonly string[],
): ReviewFinding {
  const named = anchors.slice(0, MAX_NAMED_HEADINGS).map((anchor) => `\`#${anchor}\``);
  return {
    file,
    line,
    category: "docs",
    severity: "low",
    title: `Link to ${path} points at a heading that does not exist`,
    explanation:
      `\`${target}\` names an anchor that \`${path}\` does not have at this pull request's head.` +
      (named.length === 0 ? " It has no headings." : ` Its anchors include ${named.join(", ")}.`),
    confidence: 1,
  };
}

function hasAnchor(anchors: readonly string[], fragment: string): boolean {
  const wanted = fragment.toLowerCase().replace(/^user-content-/, "");
  return anchors.some((anchor) => anchor.toLowerCase() === wanted);
}

/** One finding per link an added doc line makes to a missing file or heading. Never throws. */
export async function checkDocLinks({
  index,
  scope,
  pullRequest,
  readHead,
}: DocLinkCheck): Promise<ReviewFinding[]> {
  const exists = headExistence(index, pullRequest);
  const changedAtHead = new Set(
    pullRequest.filter((file) => file.status !== "removed").map((file) => file.filename),
  );
  const heads = new Map<string, Promise<string | undefined>>();
  const headOf = (path: string): Promise<string | undefined> => {
    let read = heads.get(path);
    if (read === undefined) {
      read = readHead(path).catch(() => undefined);
      heads.set(path, read);
    }
    return read;
  };
  const anchorsAt = async (path: string): Promise<readonly string[] | undefined> => {
    if (!changedAtHead.has(path)) {
      return index?.docs.get(path)?.anchors;
    }
    const contents = await headOf(path);
    return contents === undefined ? undefined : readDoc(path, contents).anchors;
  };

  const findings: ReviewFinding[] = [];
  for (const file of scope) {
    if (file.status === "removed" || !isDocPath(file.filename)) {
      continue;
    }
    const added = new Set(patchLines(file.patch).added.map((entry) => entry.line));
    const contents = added.size === 0 ? undefined : await headOf(file.filename);
    if (contents === undefined) {
      continue;
    }
    const seen = new Set<string>();
    for (const link of readDoc(file.filename, contents).links) {
      const destination = resolveDocLink(file.filename, link.target);
      const key = `${link.line} ${link.target}`;
      if (!added.has(link.line) || destination === undefined || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const found = exists(destination.path);
      if (found === false) {
        findings.push(missingFile(file.filename, link.line, link.target, destination.path));
        continue;
      }
      if (
        found !== true ||
        destination.fragment === "" ||
        LINE_ANCHOR.test(destination.fragment) ||
        !isDocPath(destination.path)
      ) {
        continue;
      }
      const anchors = await anchorsAt(destination.path);
      if (anchors !== undefined && !hasAnchor(anchors, destination.fragment)) {
        findings.push(missingAnchor(file.filename, link.line, link.target, destination.path, anchors));
      }
    }
  }
  return findings;
}

/** Checked findings first, then the agent's, without a second finding on the same line. */
export function mergeCheckedFindings(
  checked: readonly ReviewFinding[],
  validated: readonly ReviewFinding[],
): ReviewFinding[] {
  const taken = new Set(checked.map((finding) => `${finding.file} ${finding.line} ${finding.category}`));
  const rest = validated.filter(
    (finding) => !taken.has(`${finding.file} ${finding.line} ${finding.category}`),
  );
  return [...checked, ...rest].slice(0, MAX_FINDINGS);
}
