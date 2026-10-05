// Just enough glob for this config: `**`, `*`, `?` and `{a,b}` over `/`-separated paths.
export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      out += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map(escape)
        .join("|")})`;
      i = end;
    } else out += escape(c);
  }
  return new RegExp(`${out}$`);
}

function escape(text: string): string {
  return text.replace(/[.+^$()|[\]\\]/g, "\\$&");
}

export function matchesAny(file: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file));
}
