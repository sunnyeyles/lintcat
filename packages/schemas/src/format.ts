/** "1 finding" / "3 agents"; `many` defaults to `one` plus "s". */
export function countLabel(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `file` alone, or `file:line` when the finding is line-anchored. */
export function findingLocation(finding: { file: string; line?: number | undefined }): string {
  return finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
