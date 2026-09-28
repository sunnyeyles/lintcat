/** A changed file's siblings: the unchanged files beside it that play its role. */
import type { IndexedFile, RepositoryIndex } from "#src/build";
import { languageOf } from "#src/languages";
import { directoryOf } from "#src/paths";
import { classifyFileRole } from "#src/roles";

/** Same directory and role, minus `changed`; files in the path's own language come first. */
export function siblingsOf(
  index: RepositoryIndex,
  path: string,
  changed: ReadonlySet<string>,
): IndexedFile[] {
  const directory = directoryOf(path);
  const role = index.files.get(path)?.role ?? classifyFileRole(path);
  const language = languageOf(path);
  const same: IndexedFile[] = [];
  const other: IndexedFile[] = [];
  for (const file of index.files.values()) {
    if (
      file.path === path ||
      file.role !== role ||
      changed.has(file.path) ||
      directoryOf(file.path) !== directory
    ) {
      continue;
    }
    (file.language === language ? same : other).push(file);
  }
  return [...same, ...other];
}
