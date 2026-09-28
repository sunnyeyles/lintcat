import type { AgentDefinition, CategoryDefinition } from "#src/agents/definition";

/** The kinds of drift the reviewer reports, one finding category each. */
export const DRIFT_CATEGORIES = [
  {
    slug: "naming",
    covers:
      "a name — function, variable, type, file, export, route, table, event or flag — chosen differently from how the repository names the same kind of thing",
  },
  {
    slug: "pattern",
    covers:
      "code that does a job differently from how the repository already does it: a re-implemented helper, a bypassed layer, a hand-rolled version of an established construct",
  },
  {
    slug: "docs",
    covers:
      "documentation or a code comment this change made false; rewording that leaves a doc less specific is not drift",
  },
  {
    slug: "style",
    covers:
      "a structural habit the siblings share and no formatter or linter enforces — export style, error shape, module layout — that the change breaks",
  },
  {
    slug: "config",
    covers:
      "configuration or dependency drift: a setting or env var declared differently from the others, or a dependency that duplicates one already used for the same job",
  },
] as const satisfies readonly CategoryDefinition[];

export const GENERAL_AGENT: AgentDefinition = {
  name: "general",
  role: "Codebase drift reviewer",
  categories: DRIFT_CATEGORIES,
  focus: `Review the pull request for codebase drift: places where the change departs from how the rest of this repository already does the same thing. The code may work; what you report is that it no longer matches the codebase around it, so the next reader has two conventions where there was one.
Naming first, then patterns: how the neighbouring files name their functions, types, files and exports, and how they structure the same kind of work.
Every finding rests on evidence: at least two places in files this pull request does not change that show the convention, cited in "evidence". A convention seen once is not a convention. When the existing files disagree among themselves there is no convention to drift from, and nothing to report.
Out of scope, even when you notice them: correctness bugs, security holes, performance problems and missing tests are not drift, so do not report them. Nor anything a formatter, linter, typecheck or build already catches.
Prefer a few well-evidenced findings over many small ones.`,
  contextGuidance: `The opening message lists sibling files for each changed file: unchanged files in the same directory with the same role. They are the local convention — read them with get_file before judging a name or a pattern, and cite the lines you read as evidence. Use search_repository and find_references to see how the rest of the repository names or does the same thing, and get_base_file to see what a modified file did before. A file this pull request does not change reads the same at base and head, so count evidence lines from the start of the file get_file returns. Do not report whether an import resolves; the build checks that. Cite only lines you have read.`,
};
