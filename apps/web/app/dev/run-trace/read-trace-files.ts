export type TraceFile = { name: string; text: string };

const TRACE = /\.(jsonl|json)$/i;

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

export async function readFileList(files: Iterable<File>): Promise<TraceFile[]> {
  const kept = [...files].filter((file) => TRACE.test(file.name));
  return Promise.all(kept.map(async (file) => ({ name: pathOf(file), text: await file.text() })));
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function collect(entry: FileSystemEntry, out: TraceFile[]): Promise<void> {
  if (entry.isFile) {
    if (!TRACE.test(entry.name)) return;
    const file = await entryFile(entry as FileSystemFileEntry);
    out.push({ name: entry.fullPath.replace(/^\//, ""), text: await file.text() });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries pages: keep calling until it returns an empty batch.
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
    await Promise.all(batch.map((child) => collect(child, out)));
  }
}

/** Reads dropped files and folders, recursing into directories. */
export async function readDrop(transfer: DataTransfer): Promise<TraceFile[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);
  if (entries.length === 0) return readFileList(transfer.files);
  const out: TraceFile[] = [];
  await Promise.all(entries.map((entry) => collect(entry, out)));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
