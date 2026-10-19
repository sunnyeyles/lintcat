// Blanks comments and string contents so code-scoped rules see only code; line numbers survive.
export function stripNonCode(source: string): string {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  const keep = (c: string) => out.push(c === "\n" ? "\n" : " ");
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") keep(source[i++]!);
    } else if (c === "/" && next === "*") {
      keep(c);
      keep(next);
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) keep(source[i++]!);
      if (i < n) {
        keep("*");
        keep("/");
        i += 2;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      out.push(c);
      i++;
      while (i < n && source[i] !== c) {
        if (source[i] === "\\") {
          keep(source[i++]!);
          if (i < n) keep(source[i++]!);
          continue;
        }
        if (c === "`" && source[i] === "$" && source[i + 1] === "{") {
          i = copyTemplateExpression(source, i, out);
          continue;
        }
        keep(source[i++]!);
      }
      if (i < n) {
        out.push(c);
        i++;
      }
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join("");
}

function copyTemplateExpression(source: string, start: number, out: string[]): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const c = source[i]!;
    out.push(c);
    i++;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return i;
}
