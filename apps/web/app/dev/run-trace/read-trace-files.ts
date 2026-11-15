import { LIMITS } from "@/lib/run-trace/adapters/types";
import { TRACE_FILE, unzipTraceFiles } from "@/lib/run-trace/unzip";

export type TraceFile = { name: string; text: string };

const ZIP = /\.zip$/i;

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

async function readOne(file: File, name: string): Promise<TraceFile[]> {
  if (file.size > LIMITS.bytes) throw new Error(`${file.name} is larger than ${LIMITS.bytes / 1024 / 1024} MB.`);
  if (ZIP.test(file.name)) {
    const prefix = name.replace(ZIP, "");
    return (await unzipTraceFiles(await file.arrayBuffer())).map((entry) => ({ ...entry, name: `${prefix}/${entry.name}` }));
  }
  return TRACE_FILE.test(file.name) ? [{ name, text: await file.text() }] : [];
}

export async function readFileList(files: Iterable<File>): Promise<TraceFile[]> {
  const read = await Promise.all([...files].map((file) => readOne(file, pathOf(file))));
  return read.flat();
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function collect(entry: FileSystemEntry, out: TraceFile[]): Promise<void> {
  if (out.length > LIMITS.files) return;
  if (entry.isFile) {
    if (!TRACE_FILE.test(entry.name) && !ZIP.test(entry.name)) return;
    const file = await entryFile(entry as FileSystemFileEntry);
    out.push(...(await readOne(file, entry.fullPath.replace(/^\//, ""))));
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries pages: keep calling until it returns an empty batch.
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
    await Promise.all(batch.map((child) => collect(child, out)));
  }
}

/** Reads dropped files, folders and zips, recursing into directories. */
export async function readDrop(transfer: DataTransfer): Promise<TraceFile[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);
  if (entries.length === 0) return readFileList(transfer.files);
  const out: TraceFile[] = [];
  await Promise.all(entries.map((entry) => collect(entry, out)));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
