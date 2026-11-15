import { LIMITS, type RunFile } from "@/lib/run-trace/adapters/types";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export const TRACE_FILE = /\.(jsonl|ndjson|json|md)$/i;

export class ZipError extends Error {}

async function inflate(data: Uint8Array, budget: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > budget) {
      await reader.cancel();
      throw new ZipError("The zip expands past the size limit.");
    }
    chunks.push(read.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function findEnd(view: DataView): number {
  const stop = Math.max(0, view.byteLength - 65_557);
  for (let i = view.byteLength - 22; i >= stop; i--) if (view.getUint32(i, true) === EOCD) return i;
  throw new ZipError("Not a zip file.");
}

/** Trace files inside a zip; stored and deflated entries only, capped in count and expanded size. */
export async function unzipTraceFiles(buffer: ArrayBuffer): Promise<RunFile[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const end = findEnd(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) throw new ZipError("Zip64 archives are not supported.");

  const decoder = new TextDecoder();
  const files: RunFile[] = [];
  let budget: number = LIMITS.bytes;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL) throw new ZipError("Corrupt zip directory.");
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extra + comment;

    if (name.endsWith("/") || name.startsWith("__MACOSX/") || !TRACE_FILE.test(name)) continue;
    if (files.length >= LIMITS.files) throw new ZipError(`The zip holds more than ${LIMITS.files} trace files.`);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new ZipError("Corrupt zip entry.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8) content = await inflate(data, budget);
    else throw new ZipError(`Unsupported zip compression (method ${method}).`);
    budget -= content.byteLength;
    if (budget < 0) throw new ZipError("The zip expands past the size limit.");
    files.push({ name, text: decoder.decode(content) });
  }
  return files;
}
