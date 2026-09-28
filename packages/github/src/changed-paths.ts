import type { ChangedFile } from "#src/client";

/** Every path a pull request touches, both sides of a rename included. */
export function changedPaths(files: readonly ChangedFile[]): Set<string> {
  return new Set(
    files.flatMap((file) =>
      file.previous_filename === undefined
        ? [file.filename]
        : [file.filename, file.previous_filename],
    ),
  );
}
