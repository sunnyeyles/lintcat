/** Which source file a test file covers, by naming convention alone. */
import {
  basenameOf,
  directoryOf,
  extensionOf,
  SOURCE_EXTENSIONS,
} from "#src/paths";
import { testSubject } from "#src/test-names";

/** A test directory whose sibling directory holds the source. */
const HOISTED_DIRECTORY = "__tests__";

/**
 * Source paths `testPath` could cover, in preference order: the name its own
 * convention points at beside it, then `__tests__/foo.ts` one level up.
 */
export function coveredSourcePaths(testPath: string): string[] {
  const directory = directoryOf(testPath);
  const base = basenameOf(testPath);

  const named = testSubject(base);
  const own = named?.extension ?? extensionOf(testPath);
  const stem =
    named?.stem ?? (own === "" ? base : base.slice(0, -own.length - 1));

  const segments = directory === "" ? [] : directory.split("/");
  const directories = [directory];
  if (segments.at(-1) === HOISTED_DIRECTORY) {
    directories.push(segments.slice(0, -1).join("/"));
  }

  const extensions = [
    ...(own === "" ? [] : [own]),
    ...SOURCE_EXTENSIONS.filter((candidate) => candidate !== own),
  ];

  const paths: string[] = [];
  for (const parent of directories) {
    for (const extension of extensions) {
      const path = parent === "" ? `${stem}.${extension}` : `${parent}/${stem}.${extension}`;
      if (path !== testPath) {
        paths.push(path);
      }
    }
  }
  return paths;
}
