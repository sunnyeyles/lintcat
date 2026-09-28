/** The worker's structured logger; every line is one JSON object on stdout. */
type Fields = Record<string, unknown>;

function emit(level: string, event: string, fields: Fields): void {
  process.stdout.write(`${JSON.stringify({ level, event, ...fields })}\n`);
}

export const logger = {
  info: (event: string, fields: Fields = {}): void => emit("info", event, fields),
  warn: (event: string, fields: Fields = {}): void => emit("warn", event, fields),
  error: (event: string, fields: Fields = {}): void => emit("error", event, fields),
};
