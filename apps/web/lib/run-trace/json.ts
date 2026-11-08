export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** One object per parseable line; blank, broken and non-object lines are dropped. */
export function parseJsonl(text: string): JsonObject[] {
  const records: JsonObject[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const record = asObject(JSON.parse(trimmed));
      if (record) records.push(record);
    } catch {
      continue;
    }
  }
  return records;
}

export function parseJson(text: string): JsonObject | undefined {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}
