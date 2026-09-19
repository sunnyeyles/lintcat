/** Which source file a test file covers, by naming convention alone. */

/** Extensions a source file could carry, tried after the test's own. */
const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rb",
];

const TEST_BASENAME = /^(.+)\.(test|spec)\.([^.]+)$/;

/** A test directory whose sibling directory holds the source. */
const HOISTED_DIRECTORY = "__tests__";

/**
 * Source paths `testPath` could cover, in preference order: `foo.test.ts` and
 * `foo.spec.ts` beside it, `__tests__/foo.ts` one level up.
 */
export function coveredSourcePaths(testPath: string): string[] {
  const slash = testPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : testPath.slice(0, slash);
  const base = testPath.slice(slash + 1);

  const named = TEST_BASENAME.exec(base);
  const dot = base.lastIndexOf(".");
  const stem = named?.[1] ?? (dot <= 0 ? base : base.slice(0, dot));
  const own = named?.[3] ?? (dot <= 0 ? "" : base.slice(dot + 1));

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
