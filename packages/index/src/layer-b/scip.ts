/**
 * The vendored SCIP schema, loaded at runtime. Only the fields Layer B reads
 * are exposed, and every line is converted to one-based on the way out.
 */
import { fileURLToPath } from "node:url";

import protobuf from "protobufjs";

/** SymbolRole bits (scip.proto); the field is a bitset. */
export const SCIP_DEFINITION_ROLE = 0x1;
export const SCIP_IMPORT_ROLE = 0x2;

/** Lines are one-based, characters are the zero-based ones SCIP emits. */
export interface ScipRange {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface ScipOccurrence {
  symbol: string;
  range: ScipRange;
  roles: number;
  /** The whole definition node, when the indexer emitted one. */
  enclosingRange?: ScipRange | undefined;
}

export interface ScipSymbolInformation {
  symbol: string;
  /** SymbolInformation.Kind by name, e.g. "Class"; absent when unspecified. */
  kind?: string | undefined;
  displayName?: string | undefined;
}

export interface ScipDocument {
  relativePath: string;
  language: string;
  occurrences: readonly ScipOccurrence[];
  symbols: readonly ScipSymbolInformation[];
}

export interface ScipIndex {
  documents: readonly ScipDocument[];
}

const PROTO_PATH = fileURLToPath(new URL("../../scip/scip.proto", import.meta.url));

let cachedRoot: protobuf.Root | undefined;

/** Parsed once per process; also what the tests encode with. */
export function scipRoot(): protobuf.Root {
  cachedRoot ??= protobuf.loadSync(PROTO_PATH);
  return cachedRoot;
}

interface RawTypedRange {
  line?: number | null;
  startLine?: number | null;
  startCharacter?: number | null;
  endLine?: number | null;
  endCharacter?: number | null;
}

interface RawOccurrence {
  symbol?: string | null;
  symbolRoles?: number | null;
  range?: number[] | null;
  singleLineRange?: RawTypedRange | null;
  multiLineRange?: RawTypedRange | null;
  enclosingRange?: number[] | null;
  singleLineEnclosingRange?: RawTypedRange | null;
  multiLineEnclosingRange?: RawTypedRange | null;
}

interface RawSymbolInformation {
  symbol?: string | null;
  kind?: number | null;
  displayName?: string | null;
}

interface RawDocument {
  relativePath?: string | null;
  language?: string | null;
  occurrences?: RawOccurrence[] | null;
  symbols?: RawSymbolInformation[] | null;
}

interface RawIndex {
  documents?: RawDocument[] | null;
}

/** `[startLine, startChar, endLine, endChar]`, or three elements on one line. */
function fromNumbers(values: number[] | null | undefined): ScipRange | undefined {
  if (values === null || values === undefined) return undefined;
  const [start, startChar, third, fourth] = values;
  if (start === undefined || startChar === undefined || third === undefined) {
    return undefined;
  }
  return fourth === undefined
    ? { startLine: start + 1, startChar, endLine: start + 1, endChar: third }
    : { startLine: start + 1, startChar, endLine: third + 1, endChar: fourth };
}

function fromTyped(
  single: RawTypedRange | null | undefined,
  multi: RawTypedRange | null | undefined,
): ScipRange | undefined {
  if (single !== null && single !== undefined) {
    const line = (single.line ?? 0) + 1;
    return {
      startLine: line,
      startChar: single.startCharacter ?? 0,
      endLine: line,
      endChar: single.endCharacter ?? 0,
    };
  }
  if (multi !== null && multi !== undefined) {
    return {
      startLine: (multi.startLine ?? 0) + 1,
      startChar: multi.startCharacter ?? 0,
      endLine: (multi.endLine ?? 0) + 1,
      endChar: multi.endCharacter ?? 0,
    };
  }
  return undefined;
}

function occurrenceOf(raw: RawOccurrence): ScipOccurrence | undefined {
  const symbol = raw.symbol ?? "";
  const range =
    fromTyped(raw.singleLineRange, raw.multiLineRange) ?? fromNumbers(raw.range);
  if (symbol === "" || range === undefined) return undefined;
  return {
    symbol,
    range,
    roles: raw.symbolRoles ?? 0,
    enclosingRange:
      fromTyped(raw.singleLineEnclosingRange, raw.multiLineEnclosingRange) ??
      fromNumbers(raw.enclosingRange),
  };
}

/** Decodes an `Index` message; unnamed or unpositioned occurrences are dropped. */
export function decodeScipIndex(bytes: Uint8Array): ScipIndex {
  const root = scipRoot();
  const kinds = root.lookupEnum("scip.SymbolInformation.Kind").valuesById;
  const decoded = root.lookupType("scip.Index").decode(bytes) as unknown as RawIndex;

  return {
    documents: (decoded.documents ?? []).map((document) => ({
      relativePath: document.relativePath ?? "",
      language: document.language ?? "",
      occurrences: (document.occurrences ?? []).flatMap((raw) => {
        const occurrence = occurrenceOf(raw);
        return occurrence === undefined ? [] : [occurrence];
      }),
      symbols: (document.symbols ?? []).flatMap((raw) => {
        const symbol = raw.symbol ?? "";
        if (symbol === "") return [];
        const kind = raw.kind ?? 0;
        return [
          {
            symbol,
            kind: kind === 0 ? undefined : kinds[kind],
            displayName: raw.displayName === "" ? undefined : (raw.displayName ?? undefined),
          },
        ];
      }),
    })),
  };
}
