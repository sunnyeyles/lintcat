export type Option = { value: string; label: string };

/** A `{ value: label }` table as select options, in its own order. */
export function toOptions(record: Readonly<Record<string, string>>): Option[] {
  return Object.entries(record).map(([value, label]) => ({ value, label }));
}

/** The message a failed form parse shows: its first issue. */
export function firstIssue(parsed: { error: { issues: readonly { message: string }[] } }): string {
  return parsed.error.issues[0]?.message ?? "Check the form.";
}
