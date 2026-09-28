/** The `<doc_mentions>` block: unchanged doc lines naming something the diff's code changes. */
import { changedPaths } from "@pr-review/github";
import {
  changedNames,
  docLinesMentioning,
  type RepositoryIndex,
} from "@pr-review/index";

import type { ReviewContext } from "#src/agent-contract";

/** Doc lines quoted before the rest become a count. */
const MAX_LISTED_DOC_LINES = 20;

export function renderDocMentions(
  index: RepositoryIndex | undefined,
  context: Pick<ReviewContext, "changedFiles" | "incremental">,
): string[] {
  if (index === undefined) {
    return [];
  }
  const changed = changedPaths((context.incremental ?? context).changedFiles);
  const mentions = docLinesMentioning(index, changedNames(context.changedFiles), changed);
  if (mentions.length === 0) {
    return [];
  }
  const more = mentions.length - MAX_LISTED_DOC_LINES;
  return [
    "<doc_mentions>",
    "Lines in docs this pull request does not change that name something its code adds, removes or edits. Report one only if the change made it false, and cite it as evidence.",
    ...mentions
      .slice(0, MAX_LISTED_DOC_LINES)
      .map((mention) => `- ${mention.file}:${mention.line} (${mention.terms.join(", ")}): ${mention.text}`),
    ...(more > 0 ? [`- [... ${more} more lines]`] : []),
    "</doc_mentions>",
    "",
  ];
}
