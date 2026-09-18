/**
 * SCIP symbol strings: `scheme ' ' manager ' ' package ' ' version ' ' descriptors`
 * (scip.proto's grammar). `local N` symbols never leave their document.
 */
import type { SymbolKind } from "../types.js";

export type DescriptorSuffix =
  | "namespace"
  | "type"
  | "term"
  | "meta"
  | "macro"
  | "method"
  | "parameter"
  | "typeParameter";

export interface ScipDescriptor {
  name: string;
  suffix: DescriptorSuffix;
}

export interface ParsedSymbol {
  descriptors: readonly ScipDescriptor[];
  /** The last descriptor's name: `Foo#bar().` is `bar`. */
  name: string;
  exported: boolean;
}

const SUFFIX_BY_CHARACTER: Readonly<Record<string, DescriptorSuffix>> = {
  "/": "namespace",
  "#": "type",
  ".": "term",
  ":": "meta",
  "!": "macro",
};

/** Header fields before the descriptors; a literal space is written twice. */
function descriptorsFrom(symbol: string): string | undefined {
  let fields = 0;
  let at = 0;
  while (at < symbol.length) {
    if (symbol[at] !== " ") {
      at += 1;
      continue;
    }
    if (symbol[at + 1] === " ") {
      at += 2;
      continue;
    }
    fields += 1;
    at += 1;
    if (fields === 4) return symbol.slice(at);
  }
  return undefined;
}

function readEscaped(text: string, start: number): { name: string; next: number } | undefined {
  let at = start + 1;
  let name = "";
  while (at < text.length) {
    if (text[at] === "`") {
      if (text[at + 1] !== "`") return { name, next: at + 1 };
      name += "`";
      at += 2;
      continue;
    }
    name += text.charAt(at);
    at += 1;
  }
  return undefined;
}

function readDelimited(
  text: string,
  start: number,
  close: string,
  suffix: DescriptorSuffix,
): { descriptor: ScipDescriptor; next: number } | undefined {
  const end = text.indexOf(close, start + 1);
  if (end === -1) return undefined;
  return { descriptor: { name: text.slice(start + 1, end), suffix }, next: end + 1 };
}

function parseDescriptors(text: string): ScipDescriptor[] | undefined {
  const descriptors: ScipDescriptor[] = [];
  let at = 0;
  while (at < text.length) {
    const head = text[at];
    if (head === "(" || head === "[") {
      const read = readDelimited(
        text,
        at,
        head === "(" ? ")" : "]",
        head === "(" ? "parameter" : "typeParameter",
      );
      if (read === undefined) return undefined;
      descriptors.push(read.descriptor);
      at = read.next;
      continue;
    }

    let name: string;
    if (head === "`") {
      const read = readEscaped(text, at);
      if (read === undefined) return undefined;
      name = read.name;
      at = read.next;
    } else {
      let end = at;
      while (end < text.length && !"/#.:!(".includes(text.charAt(end))) end += 1;
      name = text.slice(at, end);
      at = end;
    }

    const character = text[at];
    if (character === undefined) return undefined;
    if (character === "(") {
      const close = text.indexOf(").", at);
      if (close === -1) return undefined;
      descriptors.push({ name, suffix: "method" });
      at = close + 2;
      continue;
    }
    const suffix = SUFFIX_BY_CHARACTER[character];
    if (suffix === undefined) return undefined;
    descriptors.push({ name, suffix });
    at += 1;
  }
  return descriptors.length === 0 ? undefined : descriptors;
}

/** Exported: exactly one descriptor after the leading file/namespace path. */
function isExported(descriptors: readonly ScipDescriptor[]): boolean {
  const first = descriptors.findIndex((descriptor) => descriptor.suffix !== "namespace");
  return first !== -1 && descriptors.length - first === 1;
}

/** Undefined for a `local N` symbol or anything that does not parse. */
export function parseScipSymbol(symbol: string): ParsedSymbol | undefined {
  if (symbol.startsWith("local ")) return undefined;
  const text = descriptorsFrom(symbol);
  if (text === undefined || text === "") return undefined;
  const descriptors = parseDescriptors(text);
  if (descriptors === undefined) return undefined;
  const last = descriptors[descriptors.length - 1];
  if (last === undefined) return undefined;
  return { descriptors, name: last.name, exported: isExported(descriptors) };
}

function typeKind(informationKind: string | undefined): SymbolKind {
  switch (informationKind) {
    case "Interface":
    case "Protocol":
    case "Trait":
      return "interface";
    case "Enum":
      return "enum";
    case "Type":
    case "TypeAlias":
    case "TypeFamily":
      return "type";
    default:
      return "class";
  }
}

/** SymbolInformation.kind refines a type descriptor; scip-typescript sends none. */
export function symbolKind(
  descriptors: readonly ScipDescriptor[],
  informationKind?: string | undefined,
): SymbolKind {
  const last = descriptors[descriptors.length - 1];
  const previous = descriptors[descriptors.length - 2];
  if (last === undefined) return "unknown";
  switch (last.suffix) {
    case "method":
      return previous?.suffix === "type" ? "method" : "function";
    case "type":
      return typeKind(informationKind);
    case "term":
      return previous?.suffix === "type" ? "property" : "variable";
    case "namespace":
      return "module";
    default:
      return "unknown";
  }
}
