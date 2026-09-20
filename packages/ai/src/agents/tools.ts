/**
 * The read-only, repository-scoped tools a review agent gets; there is no write
 * tool here. Repository scope comes from the job, not the model.
 */
import type {
  ChangedFile,
  CodeSearchResult,
  PullRequestReadClient,
  RepositoryHistoryClient,
} from "@pr-review/github";
import { referencesTo, type RepositoryIndex } from "@pr-review/index";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ReviewContext } from "#src/agent-contract";
import { INDEX_ABSENT_LINE } from "#src/agents/repository-index";
import { truncateWithMarker } from "#src/agents/truncate";

/** `listCommitFiles` is optional: without it, nothing co-changed, which is what a client with no commit graph means. */
export type ReviewToolsClient = PullRequestReadClient &
  Pick<RepositoryHistoryClient, "listCommitShas"> &
  Partial<Pick<RepositoryHistoryClient, "listCommitFiles">>;

/** Tool results larger than this are truncated to bound token usage. */
const MAX_TOOL_RESULT_CHARS = 50_000;

// Bounded by these, not by truncate(): truncation would cut the JSON mid-string.
export const MAX_SEARCH_MATCHES = 20;

const MAX_SNIPPETS_PER_MATCH = 2;

const MAX_SNIPPET_CHARS = 400;

const TRUNCATION_MARKER = "\n[... truncated: result exceeded the size limit]";

function truncate(content: string): string {
  return truncateWithMarker(content, MAX_TOOL_RESULT_CHARS, TRUNCATION_MARKER);
}

/** Trimmed, deduplicated, and capped — the snippets the model actually sees. */
function boundSnippets(snippets: readonly string[]): string[] {
  return [...new Set(snippets.map((snippet) => snippet.trim()))]
    .filter((snippet) => snippet !== "")
    .slice(0, MAX_SNIPPETS_PER_MATCH)
    .map((snippet) => truncateWithMarker(snippet, MAX_SNIPPET_CHARS, "…"));
}

function renderSearchResult(result: CodeSearchResult): string {
  return JSON.stringify(
    {
      totalCount: result.totalCount,
      incompleteResults: result.incompleteResults,
      matches: result.matches.slice(0, MAX_SEARCH_MATCHES).map((match) => ({
        path: match.path,
        name: match.name,
        snippets: boundSnippets(match.snippets),
      })),
    },
    null,
    2,
  );
}

/** A repository-relative path: no absolute paths, no traversal, no dot segments. */
const repositoryPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (path) =>
      !path.includes("\0") &&
      !path.includes("\\") &&
      !path.startsWith("/") &&
      path
        .split("/")
        .every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    {
      message:
        "path must be a repository-relative file path without traversal segments",
    },
  )
  .describe('Repository-relative file path, e.g. "src/index.ts".');

/** Scope qualifiers are rejected: the client adds the only repo: qualifier. */
const searchQuerySchema = z
  .string()
  .min(1)
  .max(256)
  .refine((query) => !/\b(repo|org|user):/i.test(query), {
    message:
      "query must not contain repo:/org:/user: qualifiers; searches are always scoped to the pull request's repository",
  })
  .describe(
    'Search terms, e.g. "createSession". Do not include repo:/org:/user: qualifiers.',
  );

/** Files reported per find_references call; `total` carries the true count. */
const MAX_REFERENCE_FILES = 50;

/** An exported name, as the target file spells it. */
const exportedNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_$][\w$]*$/, {
    message: "name must be a single exported identifier",
  });

/** What the agent needs to judge an empty result: commit, completeness, languages. */
function indexHeader(index: RepositoryIndex) {
  return {
    sha: index.sha,
    truncated: index.truncated,
    languages: index.coverage,
  };
}

// Each sampled commit costs its own API call, so this is the request budget.
const MAX_HISTORY_COMMITS = 10;

// A commit past this size is a sweep, not a related edit, so it is dropped.
const MAX_SWEEP_COMMIT_FILES = 40;

/** Co-changed files reported; the rows bound the payload, not `truncate`. */
const MAX_CO_CHANGED_FILES = 20;

/** Counts appearances per path across the commits, subject excluded. */
function tallyCoChanges(
  commits: readonly (readonly string[])[],
  subject: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const files of commits) {
    for (const file of new Set(files)) {
      if (file !== subject) {
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }
  }
  return counts;
}

const emptyInputSchema = z.strictObject({});

/** One changed file's patch; a file outside the PR, or without one, is an error. */
function patchFor(changedFiles: readonly ChangedFile[], path: string): string {
  const file = changedFiles.find((entry) => entry.filename === path);
  if (file === undefined) {
    throw new Error(`${path} is not a file this pull request changed`);
  }
  if (file.patch === undefined) {
    throw new Error(`${path} has no patch to show (for example, a binary file)`);
  }
  return file.patch;
}

/** Why the index has no node for a path, or undefined when it has one. */
function unknownReason(
  changedFiles: readonly ChangedFile[],
  index: RepositoryIndex,
  path: string,
): string | undefined {
  const added = changedFiles.some(
    (file) => file.filename === path && file.status === "added",
  );
  if (added) {
    return "added by this pull request, so the base commit has no node for it";
  }
  if (!index.files.has(path)) {
    return "not in the index at this commit";
  }
  return undefined;
}

/** Exactly the eight read-only tools, bound to one pull request. */
export function createReviewTools(
  github: ReviewToolsClient,
  context: ReviewContext,
  index?: RepositoryIndex | undefined,
): ToolSet {
  const { owner, repo } = context;
  // Tools serve the whole pull request, even when the reviewed diff is narrowed.
  const whole = context.incremental ?? context;
  // Commits are immutable, so one fetch per SHA serves every call this run.
  const commitFiles = new Map<string, Promise<string[]>>();
  const filesOf = (sha: string): Promise<string[]> => {
    let files = commitFiles.get(sha);
    if (files === undefined) {
      files = github.listCommitFiles?.({ owner, repo, sha }) ?? Promise.resolve([]);
      commitFiles.set(sha, files);
    }
    return files;
  };

  return {
    get_pull_request: tool({
      description:
        "Get the pull request's title, description, author, branches, and commit SHAs as JSON.",
      inputSchema: emptyInputSchema,
      async execute() {
        return truncate(JSON.stringify(context.pullRequest, null, 2));
      },
    }),
    list_changed_files: tool({
      description:
        "List the files changed by the pull request (filename, status, additions, deletions) as JSON.",
      inputSchema: emptyInputSchema,
      async execute() {
        const listed = whole.changedFiles.map(
          ({ filename, status, additions, deletions }) => ({
            filename,
            status,
            additions,
            deletions,
          }),
        );
        return truncate(JSON.stringify(listed, null, 2));
      },
    }),
    get_diff: tool({
      description:
        "Get one changed file's whole patch by path, or the full unified diff with no path. " +
        "Prefer a path: the full diff was truncated in the opening message only if it is long, " +
        "and a single patch is never cut short.",
      inputSchema: z.strictObject({
        path: repositoryPathSchema
          .optional()
          .describe("A changed file's path for its patch alone; omit for the whole diff."),
      }),
      async execute({ path }) {
        return truncate(
          path === undefined ? whole.diff : patchFor(whole.changedFiles, path),
        );
      },
    }),
    get_file: tool({
      description:
        "Read one file's contents at the pull request's HEAD commit (the proposed state). " +
        'The path is relative to the repository root, e.g. "src/index.ts".',
      inputSchema: z.strictObject({ path: repositoryPathSchema }),
      async execute({ path }) {
        return truncate(
          await github.getFileContents({
            owner,
            repo,
            path,
            ref: context.pullRequest.headSha,
          }),
        );
      },
    }),
    get_base_file: tool({
      description:
        "Read one file's contents at the pull request's BASE commit (the state before this PR). " +
        'The path is relative to the repository root, e.g. "src/index.ts".',
      inputSchema: z.strictObject({ path: repositoryPathSchema }),
      async execute({ path }) {
        return truncate(
          await github.getFileContents({
            owner,
            repo,
            path,
            ref: context.pullRequest.baseSha,
          }),
        );
      },
    }),
    search_repository: tool({
      description:
        "Search code within the pull request's repository. Returns matching files with short " +
        "snippets of the matching code, and totalCount, the number of matches in the whole " +
        "repository — far more than the page returned means the query was not selective enough. " +
        "The search is always scoped to this repository; scope qualifiers are not allowed.",
      inputSchema: z.strictObject({ query: searchQuerySchema }),
      async execute({ query }) {
        const result = await github.searchCode({ owner, repo, query });
        return renderSearchResult(result);
      },
    }),
    find_references: tool({
      description:
        "Find the files that import one file, read from the repository index built at the pull " +
        "request's BASE commit — the import statements themselves, not a text search. With " +
        "`name`, only the files importing that exported name; default and namespace (`*`) " +
        "imports are included and marked as such, since a namespace import reaches every name. " +
        `At most ${MAX_REFERENCE_FILES} files are returned and \`total\` is the true count. ` +
        "Every result carries an `index` header: an empty list means nothing imports the path " +
        "ONLY when that header shows the path's language indexed and truncated false. Each " +
        "indexed language also carries a `resolution` rate — the share of the repository's own " +
        "imports the index could place — so a rate below 1 means some importers are missing. A " +
        "path this pull request added, or one the index does not hold, comes back as known: false.",
      inputSchema: z.strictObject({
        path: repositoryPathSchema,
        name: exportedNameSchema
          .optional()
          .describe(
            'One exported name from `path`, e.g. "createSession"; omit it for every importer of the file.',
          ),
      }),
      async execute({ path, name }) {
        if (index === undefined) {
          return INDEX_ABSENT_LINE;
        }
        const unknown = unknownReason(whole.changedFiles, index, path);
        if (unknown !== undefined) {
          return JSON.stringify(
            { index: indexHeader(index), path, known: false, reason: unknown },
            null,
            2,
          );
        }
        const references = referencesTo(index.importers, path, name);
        return truncate(
          JSON.stringify(
            {
              index: indexHeader(index),
              path,
              ...(name === undefined ? {} : { name }),
              known: true,
              total: references.length,
              references: references.slice(0, MAX_REFERENCE_FILES),
            },
            null,
            2,
          ),
        );
      },
    }),
    find_co_changed_files: tool({
      description:
        "Find files that were edited in the same commits as this file. This is CORRELATION, not " +
        "a dependency: files co-change because one commit did two unrelated things as often as " +
        "because they belong together, and related files never edited together do not appear. " +
        `It samples the ${MAX_HISTORY_COMMITS} most recent commits touching the path, ignores ` +
        `sweeps that touched more than ${MAX_SWEEP_COMMIT_FILES} files, and reports at most ` +
        `${MAX_CO_CHANGED_FILES} files. Each commits count is out of commitsExamined; a file in ` +
        "only one of them is noise. A file this pull request adds has no history yet.",
      inputSchema: z.strictObject({ path: repositoryPathSchema }),
      async execute({ path }) {
        const shas = await github.listCommitShas({
          owner,
          repo,
          path,
          limit: MAX_HISTORY_COMMITS,
        });
        const commits = await Promise.all(shas.map(filesOf));
        const examined = commits.filter(
          (files) => files.length <= MAX_SWEEP_COMMIT_FILES,
        );
        const coChanged = [...tallyCoChanges(examined, path)]
          // Ties break on path so the same history always renders the same.
          .sort(([pathA, a], [pathB, b]) =>
            a === b ? pathA.localeCompare(pathB) : b - a,
          )
          .slice(0, MAX_CO_CHANGED_FILES)
          .map(([file, commitCount]) => ({ path: file, commits: commitCount }));
        return JSON.stringify(
          {
            path,
            commitsExamined: examined.length,
            commitsSkippedAsSweeps: commits.length - examined.length,
            coChanged,
          },
          null,
          2,
        );
      },
    }),
  };
}
