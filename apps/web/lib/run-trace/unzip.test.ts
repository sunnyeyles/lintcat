import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { unzipTraceFiles, ZipError } from "@/lib/run-trace/unzip";

// The smallest valid zip writer: enough to exercise the reader.
function zip(entries: { name: string; text: string; store?: boolean }[]): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.text);
    const data = entry.store ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.store ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, directory, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

describe("unzipTraceFiles", () => {
  it("reads stored and deflated trace files and skips the rest", async () => {
    const files = await unzipTraceFiles(
      zip([
        { name: "run/a.ndjson", text: '{"a":1}' },
        { name: "run/b.json", text: "{}", store: true },
        { name: "run/script.sh", text: "rm -rf /" },
        { name: "__MACOSX/run/a.ndjson", text: "x" },
      ]),
    );
    expect(files).toEqual([
      { name: "run/a.ndjson", text: '{"a":1}' },
      { name: "run/b.json", text: "{}" },
    ]);
  });

  it("rejects something that is not a zip", async () => {
    await expect(unzipTraceFiles(new TextEncoder().encode("hello world, not a zip").buffer as ArrayBuffer)).rejects.toThrow(ZipError);
  });
});
