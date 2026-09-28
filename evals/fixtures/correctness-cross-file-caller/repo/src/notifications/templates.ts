/** The tiny mustache-ish renderer the transactional emails share. */

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** Every placeholder is stringified, so a template never fails to render. */
export function renderTemplate(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replaceAll(PLACEHOLDER, (_match, key: string) =>
    String(values[key] ?? ""),
  );
}
