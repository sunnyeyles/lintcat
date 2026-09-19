/**
 * Reads GitHub's repository tarball into a path -> text map. Dependency-light
 * on purpose: gunzip from node:zlib and a ustar reader, so the action stays small.
 */
import { gunzipSync } from "node:zlib";

import type { RepositoryArchiveLimits } from "#src/client";

const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** Sized so a large monorepo fits; hitting one truncates, never fails. */
export const DEFAULT_ARCHIVE_LIMITS = {
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxFiles: 20_000,
  maxFileBytes: 512 * 1024,
  /** The one cap that fails rather than truncates: past it nothing fits in memory. */
  maxInflatedBytes: 8 * MAX_TOTAL_BYTES,
} as const;

/** Thrown before an archive is read, so the review falls back to no index. */
export class ArchiveTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveTooLargeError";
  }
}

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

/** Gunzips under a hard output cap; a compressed buffer already past it cannot fit. */
function inflate(tarball: Uint8Array, maxInflatedBytes: number): Uint8Array {
  if (!isGzip(tarball)) {
    return tarball;
  }
  if (tarball.length > maxInflatedBytes) {
    throw new ArchiveTooLargeError(
      `the compressed repository archive is ${tarball.length} bytes,` +
        ` over the ${maxInflatedBytes}-byte inflation cap`,
    );
  }
  try {
    return new Uint8Array(
      gunzipSync(tarball, { maxOutputLength: maxInflatedBytes }),
    );
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new ArchiveTooLargeError(
        `the repository archive inflates past the ${maxInflatedBytes}-byte cap`,
      );
    }
    throw error;
  }
}

/** Decodes a repository tarball under the given caps. Only a cap that stops
 * the read sets `truncated`; a file over the per-file cap is listed instead. */
export function readRepositoryTarball(
  tarball: Uint8Array,
  limits: RepositoryArchiveLimits = {},
): TarballContents {
  const maxInflatedBytes =
    limits.maxInflatedBytes ?? DEFAULT_ARCHIVE_LIMITS.maxInflatedBytes;

  const bytes = inflate(tarball, maxInflatedBytes);
  return collectRepositoryFiles(tarballFiles(bytes), limits);
}

function* tarballFiles(bytes: Uint8Array): Generator<RepositoryFileEntry> {
  for (const entry of tarEntries(bytes)) {
    const path = stripRootDirectory(entry.name);
    if (path !== undefined) {
      yield { path, size: entry.body.length, read: () => entry.body };
    }
  }
}

/** One file offered to collectRepositoryFiles; `read` runs only for a file that is kept. */
export interface RepositoryFileEntry {
  path: string;
  size: number;
  read: () => Uint8Array;
}

/** Applies the archive's caps and skip rules to files from any source. */
export function collectRepositoryFiles(
  entries: Iterable<RepositoryFileEntry>,
  limits: RepositoryArchiveLimits = {},
): TarballContents {
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_ARCHIVE_LIMITS.maxTotalBytes;
  const maxFiles = limits.maxFiles ?? DEFAULT_ARCHIVE_LIMITS.maxFiles;
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_ARCHIVE_LIMITS.maxFileBytes;
  const files = new Map<string, string>();
  const oversized: string[] = [];
  let truncated = false;
  let totalBytes = 0;

  for (const entry of entries) {
    if (isSkipped(entry.path)) {
      continue;
    }
    if (entry.size > maxFileBytes) {
      oversized.push(entry.path);
      continue;
    }
    if (files.size >= maxFiles || totalBytes + entry.size > maxTotalBytes) {
      truncated = true;
      break;
    }
    const text = decodeText(entry.read());
    if (text === undefined) {
      continue;
    }
    totalBytes += entry.size;
    files.set(entry.path, text);
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
