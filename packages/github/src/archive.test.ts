/** The tarball reader, against archives built byte by byte in the test. */
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { readRepositoryTarball } from "#src/archive";

const ROOT = "octo-org-example-service-0000000";

const BLOCK_SIZE = 512;

function writeAscii(block: Uint8Array, offset: number, text: string): void {
  for (let at = 0; at < text.length; at += 1) {
    block[offset + at] = text.charCodeAt(at);
  }
}

/** Six octal digits, NUL, space — the ustar spelling of a numeric field. */
function octalField(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 2, "0")}\0 `;
}

function tarEntry(
  name: string,
  body: Uint8Array,
  typeFlag = "0",
): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);
  header.set(new TextEncoder().encode(name), 0);
  writeAscii(header, 100, octalField(0o644, 8));
  writeAscii(header, 108, octalField(0, 8));
  writeAscii(header, 116, octalField(0, 8));
  writeAscii(header, 124, octalField(body.length, 12));
  writeAscii(header, 136, octalField(0, 12));
  writeAscii(header, 148, "        ");
  writeAscii(header, 156, typeFlag);
  writeAscii(header, 257, "ustar\0" + "00");

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeAscii(header, 148, octalField(checksum, 8));

  const padded = Math.ceil(body.length / BLOCK_SIZE) * BLOCK_SIZE;
  const block = new Uint8Array(BLOCK_SIZE + padded);
  block.set(header, 0);
  block.set(body, BLOCK_SIZE);
  return block;
}

type Entry = { name: string; body: Uint8Array; typeFlag?: string };

function tarball(entries: readonly Entry[]): Uint8Array {
  const blocks = entries.map((entry) =>
    tarEntry(entry.name, entry.body, entry.typeFlag ?? "0"),
  );
  // Two zeroed blocks end a tar stream.
  blocks.push(new Uint8Array(BLOCK_SIZE * 2));
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** An archive of repository-relative paths, wrapped as GitHub wraps one. */
function repositoryTarball(files: Record<string, string>): Uint8Array {
  return tarball(
    Object.entries(files).map(([path, contents]) => ({
      name: `${ROOT}/${path}`,
      body: text(contents),
    })),
  );
}

describe("readRepositoryTarball", () => {
  it("strips the wrapping directory GitHub adds", () => {
    const archive = readRepositoryTarball(
      repositoryTarball({
        "src/index.ts": "export const one = 1;\n",
        "README.md": "# Example\n",
      }),
    );

    expect([...archive.files.keys()].sort()).toEqual([
      "README.md",
      "src/index.ts",
    ]);
    expect(archive.files.get("src/index.ts")).toBe("export const one = 1;\n");
    expect(archive.truncated).toBe(false);
  });

  it("reads a gzipped archive, which is what the endpoint returns", () => {
    const gzipped = gzipSync(repositoryTarball({ "a.ts": "export {};\n" }));

    const archive = readRepositoryTarball(new Uint8Array(gzipped));

    expect(archive.files.get("a.ts")).toBe("export {};\n");
  });

  it("drops directory entries and anything under a skipped directory", () => {
    const archive = readRepositoryTarball(
      tarball([
        { name: `${ROOT}/src/`, body: new Uint8Array(0), typeFlag: "5" },
        { name: `${ROOT}/src/keep.ts`, body: text("keep\n") },
        { name: `${ROOT}/node_modules/pkg/index.js`, body: text("nope\n") },
        { name: `${ROOT}/packages/a/dist/out.js`, body: text("nope\n") },
        { name: `${ROOT}/vendor/lib.go`, body: text("nope\n") },
        { name: `${ROOT}/.git/config`, body: text("nope\n") },
      ]),
    );

    expect([...archive.files.keys()]).toEqual(["src/keep.ts"]);
    expect(archive.truncated).toBe(false);
  });

  it("keys a non-ASCII path by the name tar wrote, decoded as UTF-8", () => {
    const archive = readRepositoryTarball(
      repositoryTarball({ "src/über.ts": "export {};\n" }),
    );

    expect([...archive.files.keys()]).toEqual(["src/über.ts"]);
  });

  it("drops binary files without truncating", () => {
    const archive = readRepositoryTarball(
      tarball([
        { name: `${ROOT}/logo.png`, body: new Uint8Array([0x89, 0x50, 0, 1]) },
        { name: `${ROOT}/src/a.ts`, body: text("ok\n") },
      ]),
    );

    expect([...archive.files.keys()]).toEqual(["src/a.ts"]);
    expect(archive.truncated).toBe(false);
  });

  it("lists a file over the per-file cap without truncating", () => {
    const archive = readRepositoryTarball(
      repositoryTarball({
        "big.ts": "x".repeat(100),
        "small.ts": "y",
      }),
      { maxFileBytes: 10 },
    );

    expect([...archive.files.keys()]).toEqual(["small.ts"]);
    expect(archive.oversized).toEqual(["big.ts"]);
    expect(archive.truncated).toBe(false);
  });

  it("stops at the file-count cap and reports truncation", () => {
    const archive = readRepositoryTarball(
      repositoryTarball({ "a.ts": "a", "b.ts": "b", "c.ts": "c" }),
      { maxFiles: 2 },
    );

    expect(archive.files.size).toBe(2);
    expect(archive.truncated).toBe(true);
  });

  it("stops at the total-bytes cap and reports truncation", () => {
    const archive = readRepositoryTarball(
      repositoryTarball({ "a.ts": "aaaaa", "b.ts": "bbbbb" }),
      { maxTotalBytes: 6 },
    );

    expect([...archive.files.keys()]).toEqual(["a.ts"]);
    expect(archive.truncated).toBe(true);
  });

  it("resolves a path carried by a pax extended header", () => {
    const long = `src/${"deep/".repeat(30)}file.ts`;
    const record = `${`path=${ROOT}/${long}\n`.length + 4} path=${ROOT}/${long}\n`;

    const archive = readRepositoryTarball(
      tarball([
        { name: `${ROOT}/PaxHeader`, body: text(record), typeFlag: "x" },
        { name: `${ROOT}/truncated-name`, body: text("deep\n") },
      ]),
    );

    expect(archive.files.get(long)).toBe("deep\n");
  });

  it("reads an empty archive as no files", () => {
    const archive = readRepositoryTarball(tarball([]));

    expect(archive.files.size).toBe(0);
    expect(archive.truncated).toBe(false);
  });
});
