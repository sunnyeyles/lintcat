export type Option = { value: string; label: string };

export function toOptions(record: Readonly<Record<string, string>>): Option[] {
  return Object.entries(record).map(([value, label]) => ({ value, label }));
}

export function firstIssue(parsed: { error: { issues: readonly { message: string }[] } }): string {
  return parsed.error.issues[0]?.message ?? "Check the form.";
}
