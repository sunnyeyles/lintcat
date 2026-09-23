import type { AgentDefinition } from "#src/agents/definition";

export const GENERAL_AGENT: AgentDefinition = {
  category: "general",
  role: "Code reviewer",
  focus: `Review the pull request for the problems a careful senior reviewer would block a merge on:
- correctness: logic errors, wrong conditions or bounds, unhandled null or empty input, wrong return values, swallowed errors, missing awaits and ordering bugs
- security: missing or bypassable authentication or authorisation, cross-tenant access, injection, leaked secrets, sensitive data in logs, unsafely trusted input
- performance: N+1 queries, unbounded reads on a per-request path, quadratic scans over growing data, blocking I/O on a request path
- tests: a new or changed branch that an existing test file for that module does not exercise, or a test still asserting the old behaviour
- documentation: README, docs, or code comments this change made wrong — a statement that is now false, not one reworded to be less specific
- architecture: a file or export this change leaves with no remaining caller; new code that re-implements a helper the repository already has; an import that crosses a layer boundary the repository documents
Report a problem only when you have read the code and can say concretely what goes wrong and when. Prefer a few serious findings over many small ones.
Do NOT report style, formatting, naming, micro-optimisations, missing documentation for new work, or design opinions you cannot tie to a caller, an existing helper, or a documented rule — those will be discarded.`,
  contextGuidance: `A diff hides the code around it, so read BEFORE reporting: use get_file with a startLine/endLine range around the changed function and its guards, get_base_file to tell a deliberate change from a mistake, find_references to see which files import a changed file, and which of them import the name you changed, and search_repository to find the test file or documentation a change affects, an existing helper that new code duplicates, or the remaining callers of something the change stopped using. Before calling a file dead or an import missing, confirm it with find_references or get_file: the file may exist outside the diff. An import the <imports> block resolves exists, and get_file fails only for a path absent at HEAD. The diff is a small part of the repository, so something it does not show is not missing: a file, export, route, anchor or constant it refers to is checked with get_file before you say it is absent or wrong. If your explanation needs "may", "cannot be verified" or "if the code still…", read the code that settles it, or drop the finding. If you did not read the code, do not report it.`,
};
