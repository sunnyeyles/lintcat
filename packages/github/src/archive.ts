/**
 * Reads GitHub's repository tarball into a path -> text map. Dependency-light
 * on purpose: gunzip from node:zlib and a ustar reader, so the action stays small.
 */
import { gunzipSync } from "node:zlib";

import type { RepositoryArchiveLimits } from "#src/client";

/** Sized so a large monorepo fits; hitting one truncates, never fails. */
export const DEFAULT_ARCHIVE_LIMITS = {
  maxTotalBytes: 50 * 1024 * 1024,
  maxFiles: 20_000,
  maxFileBytes: 512 * 1024,
} as const;

/** Path segments dropped while reading: never this repository's own code. */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  ".yarn",
  "__pycache__",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "third_party",
  "vendor",
]);

const BLOCK_SIZE = 512;

/** Where the ustar header keeps each field. */
const NAME = [0, 100] as const;
const SIZE = [124, 136] as const;
const TYPE_FLAG = 156;
const PREFIX = [345, 500] as const;

/** One file entry read out of the tar stream. */
interface TarEntry {
  name: string;
  body: Uint8Array;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Numeric and flag fields only: every byte is one Latin-1 character. */
function trimmedAscii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte === 0) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text.trim();
}

/** A NUL-terminated header name, which tar writes as UTF-8. */
function trimmedName(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  const body = nul < 0 ? bytes : bytes.subarray(0, nul);
  try {
    return utf8.decode(body).trim();
  } catch {
    return trimmedAscii(body);
  }
}

function octal(bytes: Uint8Array): number {
  const digits = trimmedAscii(bytes);
  const value = Number.parseInt(digits, 8);
  return Number.isFinite(value) ? value : 0;
}

function headerName(header: Uint8Array): string {
  const name = trimmedName(header.subarray(...NAME));
  const prefix = trimmedName(header.subarray(...PREFIX));
  return prefix === "" ? name : `${prefix}/${name}`;
}

/** The `path=` record of a pax extended header, when it carries one. */
function paxPath(body: Uint8Array): string | undefined {
  const text = Buffer.from(body).toString("utf8");
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return match?.[1];
}

function isEndOfArchive(header: Uint8Array): boolean {
  return header.every((byte) => byte === 0);
}

/** Walks the tar stream, yielding regular files and resolving long names. */
function* tarEntries(bytes: Uint8Array): Generator<TarEntry> {
  let offset = 0;
  let overrideName: string | undefined;

  while (offset + BLOCK_SIZE <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK_SIZE);
    if (isEndOfArchive(header)) {
      return;
    }
    const size = octal(header.subarray(...SIZE));
    const typeFlag = String.fromCharCode(header[TYPE_FLAG] ?? 0);
    const body = bytes.subarray(offset + BLOCK_SIZE, offset + BLOCK_SIZE + size);
    offset += BLOCK_SIZE + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (typeFlag === "L") {
      overrideName = trimmedName(body);
      continue;
    }
    if (typeFlag === "x" || typeFlag === "X") {
      overrideName = paxPath(body) ?? overrideName;
      continue;
    }
    if (typeFlag === "g") {
      continue;
    }

    const name = overrideName ?? headerName(header);
    overrideName = undefined;
    // Directories, symlinks and device nodes carry no content worth indexing.
    if (typeFlag === "0" || typeFlag === "\u0000") {
      yield { name, body };
    }
  }
}

/** GitHub wraps every archive in one `owner-repo-sha/` directory. */
function stripRootDirectory(name: string): string | undefined {
  const slash = name.indexOf("/");
  if (slash < 0) {
    return undefined;
  }
  const path = name.slice(slash + 1);
  return path === "" ? undefined : path;
}

function isSkipped(path: string): boolean {
  return path
    .split("/")
    .slice(0, -1)
    .some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

/** undefined for anything that is not decodable UTF-8 text. */
function decodeText(body: Uint8Array): string | undefined {
  if (body.includes(0)) {
    return undefined;
  }
  try {
    return utf8.decode(body);
  } catch {
    return undefined;
  }
}

/** The tarball's files, with `truncated` set when the read stopped early. */
export interface TarballContents {
  files: Map<string, string>;
  truncated: boolean;
  /** Paths skipped for exceeding the per-file cap; the read carried on. */
  oversized?: readonly string[];
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Decodes a repository tarball under the given caps. Only a cap that stops
 * the read sets `truncated`; a file over the per-file cap is listed instead. */
export function readRepositoryTarball(
  tarball: Uint8Array,
  limits: RepositoryArchiveLimits = {},
): TarballContents {
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_ARCHIVE_LIMITS.maxTotalBytes;
  const maxFiles = limits.maxFiles ?? DEFAULT_ARCHIVE_LIMITS.maxFiles;
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_ARCHIVE_LIMITS.maxFileBytes;

  const bytes = isGzip(tarball) ? new Uint8Array(gunzipSync(tarball)) : tarball;
  const files = new Map<string, string>();
  const oversized: string[] = [];
  let truncated = false;
  let totalBytes = 0;

  for (const entry of tarEntries(bytes)) {
    const path = stripRootDirectory(entry.name);
    if (path === undefined || isSkipped(path)) {
      continue;
    }
    if (entry.body.length > maxFileBytes) {
      oversized.push(path);
      continue;
    }
    if (files.size >= maxFiles || totalBytes + entry.body.length > maxTotalBytes) {
      truncated = true;
      break;
    }
    const text = decodeText(entry.body);
    if (text === undefined) {
      continue;
    }
    totalBytes += entry.body.length;
    files.set(path, text);
  }

  return { files, truncated, oversized };
}

/** Normalises what Octokit hands back for a binary response body. */
export function archiveBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error("the repository archive response was not binary data");
}
