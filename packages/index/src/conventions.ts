/** Conventions measured over a changed file's siblings, so the reviewer is told them rather than left to infer them. */
import type { ImportEdge, IndexedFile, RepositoryIndex } from "#src/build";
import { INDEXED_LANGUAGES } from "#src/languages";
import { basenameOf, extensionOf, MODULE_EXTENSIONS } from "#src/paths";
import { siblingsOf } from "#src/siblings";

export const CONVENTIONS = [
  "file-name-casing",
  "test-file-naming",
  "export-style",
  "import-path",
  "import-extension",
] as const;

export type Convention = (typeof CONVENTIONS)[number];

/** `count` of the `total` siblings a convention could be read from share `value`. */
export interface ConventionCount {
  readonly convention: Convention;
  readonly value: string;
  readonly count: number;
  readonly total: number;
}

/** Fewer measurable siblings than this is too few to call a convention. */
export const MIN_MEASURED_SIBLINGS = 3;

/** The share the commonest value needs before it is a convention. */
export const MIN_MAJORITY = 0.8;

const CASINGS: readonly (readonly [string, RegExp])[] = [
  ["kebab-case", /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/],
  ["snake_case", /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/],
  ["camelCase", /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/],
  ["PascalCase", /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*$/],
  ["UPPER_CASE", /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/],
];

/** A single lowercase word fits every lowercase casing, so it says nothing. */
export function fileNameCasing(path: string): string | undefined {
  const base = basenameOf(path).replace(/^\./, "");
  const dot = base.indexOf(".");
  const stem = dot < 0 ? base : base.slice(0, dot);
  return CASINGS.find(([, pattern]) => pattern.test(stem))?.[0];
}

/** `.eval.` files are a different kind of test, not a naming variant. */
export function testFileNaming(path: string): string | undefined {
  const base = basenameOf(path).toLowerCase();
  const dotted = /\.(test|spec)\.[cm]?[jt]sx?$/.exec(base);
  if (dotted !== null) {
    return `*.${dotted[1]}.*`;
  }
  if (/_test\.(go|py|rb)$/.test(base)) {
    return "*_test.*";
  }
  return /^test_.+\.py$/.test(base) ? "test_*.py" : undefined;
}

/** One value for every import in scope, "mixed" when they differ. */
function uniform(values: readonly string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.every((value) => value === values[0]) ? values[0] : "mixed";
}

/** Imports resolved to a module in the importer's own package: the ones a style choice governs. */
function ownPackageImports(
  file: IndexedFile,
  index: RepositoryIndex,
  edges: readonly ImportEdge[],
): ImportEdge[] {
  return edges.filter((edge) => {
    const target = edge.to === undefined ? undefined : index.files.get(edge.to);
    return (
      target !== undefined &&
      target.package === file.package &&
      INDEXED_LANGUAGES.has(target.language)
    );
  });
}

type Measure = (
  file: IndexedFile,
  index: RepositoryIndex,
  edges: readonly ImportEdge[],
) => string | undefined;

const MEASURES: Record<Convention, Measure> = {
  "file-name-casing": (file) => fileNameCasing(file.path),
  "test-file-naming": (file) => testFileNaming(file.path),
  "export-style": (file) => file.exportStyle,
  "import-path": (file, index, edges) =>
    uniform(
      ownPackageImports(file, index, edges).map((edge) =>
        edge.specifier.startsWith(".") ? "relative" : "alias",
      ),
    ),
  "import-extension": (file, index, edges) =>
    uniform(
      ownPackageImports(file, index, edges).map((edge) =>
        MODULE_EXTENSIONS.includes(extensionOf(edge.specifier)) ? "extension" : "extensionless",
      ),
    ),
};

const PHRASES: Record<Convention, (value: string) => string> = {
  "file-name-casing": (value) => `use ${value} file names`,
  "test-file-naming": (value) => `are named ${value}`,
  "export-style": (value) =>
    value === "default" ? "have a default export" : "use named exports only",
  "import-path": (value) =>
    value === "relative"
      ? "import their own package by relative path"
      : "import their own package through a path alias",
  "import-extension": (value) =>
    value === "extension"
      ? "write the file extension on imports from their own package"
      : "leave the file extension off imports from their own package",
};

const edgesByFile = new WeakMap<RepositoryIndex, Map<string, ImportEdge[]>>();

function edgesFrom(index: RepositoryIndex, path: string): readonly ImportEdge[] {
  let grouped = edgesByFile.get(index);
  if (grouped === undefined) {
    grouped = new Map();
    for (const edge of index.edges) {
      const list = grouped.get(edge.from);
      if (list === undefined) {
        grouped.set(edge.from, [edge]);
      } else {
        list.push(edge);
      }
    }
    edgesByFile.set(index, grouped);
  }
  return grouped.get(path) ?? [];
}

/** The commonest value, or undefined short of a clear majority. */
function majority(convention: Convention, values: readonly string[]): ConventionCount | undefined {
  if (values.length < MIN_MEASURED_SIBLINGS) {
    return undefined;
  }
  const tally = new Map<string, number>();
  for (const value of values) {
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  const [value, count] = [...tally].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  if (value === "mixed" || count < values.length * MIN_MAJORITY) {
    return undefined;
  }
  return { convention, value, count, total: values.length };
}

/** Every convention `path`'s siblings clearly share, in CONVENTIONS order. */
export function conventionCounts(
  index: RepositoryIndex,
  path: string,
  changed: ReadonlySet<string>,
): ConventionCount[] {
  const siblings = siblingsOf(index, path, changed);
  return CONVENTIONS.flatMap((convention) => {
    const values = siblings.flatMap((sibling) => {
      const value = MEASURES[convention](sibling, index, edgesFrom(index, sibling.path));
      return value === undefined ? [] : [value];
    });
    const count = majority(convention, values);
    return count === undefined ? [] : [count];
  });
}

/** "all 4 siblings use kebab-case file names", with `subject` naming whose siblings. */
export function conventionSentence(count: ConventionCount, subject = "siblings"): string {
  const quantity =
    count.count === count.total ? `all ${count.total}` : `${count.count} of ${count.total}`;
  return `${quantity} ${subject} ${PHRASES[count.convention](count.value)}`;
}
