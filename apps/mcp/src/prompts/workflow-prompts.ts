import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const orgArg = z.string().min(1).describe('The account slug (a GitHub organization or personal account), as in the dashboard URL /o/<slug>.');
const repoArg = z.string().optional().describe('Limit to one repository, as "owner/name".');

function userPrompt(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function lines(...parts: string[]): string {
  return parts.join("\n");
}

export function registerWorkflowPrompts(server: McpServer): void {
  server.registerPrompt(
    "review_branch",
    {
      title: "Review the current branch",
      description:
        "Review the work in progress on this branch before pushing or opening a pull request. Runs the " +
        "reviewer over the diff against the base branch (commits, uncommitted and untracked files) " +
        "and walks through the findings worth acting on. Use this when the user asks for a review of " +
        "their changes, their branch or their diff, or before they open a PR.",
      argsSchema: {
        base: z
          .string()
          .optional()
          .describe('Branch or commit to compare against, e.g. "origin/main"; defaults to the remote default branch.'),
        repoPath: z.string().optional().describe("Path to the checkout; defaults to the server's working directory."),
      },
    },
    ({ base, repoPath }) => {
      const args = [
        base === undefined ? undefined : `base "${base}"`,
        repoPath === undefined ? undefined : `repoPath "${repoPath}"`,
      ].filter((part) => part !== undefined);
      return userPrompt(
        lines(
          "Review the changes on this branch before they are pushed.",
          "",
          `1. Call \`review_local_changes\`${args.length === 0 ? "" : ` with ${args.join(", ")}`}.` +
            " It calls a model and takes a minute or more; do not run it twice.",
          "2. Use `find_references` and `describe_file` to check how far a finding reaches before judging it.",
          "3. Report the findings grouped by severity, each with the file, the line and what is actually wrong.",
          "   Say plainly which ones should block the push and which can wait.",
          "",
          "Do not fix anything yet; wait for the user to choose.",
        ),
      );
    },
  );

  server.registerPrompt(
    "triage_finding",
    {
      title: "Triage one review finding",
      description:
        "Work out whether a single stored finding is real and worth fixing. Opens the review it belongs " +
        "to, reads the code around the finding and traces who depends on it, then recommends fix, defer " +
        "or dismiss with a reason. Use this when the user points at one finding from a past review or " +
        "from the dashboard and asks whether it matters.",
      argsSchema: {
        org: orgArg,
        review: z.string().min(1).describe("The review id, as listed by list_reviews."),
        finding: z
          .string()
          .optional()
          .describe("Which finding: its title, or the file and line. Omit to triage the most severe one."),
      },
    },
    ({ org, review, finding }) =>
      userPrompt(
        lines(
          `Triage ${finding === undefined ? "the most severe finding" : `the finding "${finding}"`} ` +
            `in review ${review} of account "${org}".`,
          "",
          `1. Call \`get_review\` with org "${org}" and id ${review} to read the finding: file, line, severity,`,
          "   category, explanation and suggested fix.",
          "2. Read the file at that line in the local checkout. The finding may be stale — the code can have moved on.",
          "3. Call `find_references` on that file to see who depends on it, and `describe_file` to find its test.",
          "4. Recommend one of fix now, defer or dismiss, and say why in two or three sentences. If it is a fix,",
          "   describe the change; do not make it until the user agrees.",
        ),
      ),
  );

  server.registerPrompt(
    "review_history",
    {
      title: "What the review history shows",
      description:
        "Summarise what the stored reviews say about a repository or account over time: how many " +
        "reviews ran, which categories and agents keep finding things, whether findings are trending up " +
        "or down, and what the reviews cost. Use this for retrospectives, for questions like \"what do we " +
        "keep getting wrong\", or when the user asks about review volume, trends or spend.",
      argsSchema: {
        org: orgArg,
        repo: repoArg,
        range: z.enum(["7d", "30d", "90d"]).optional().describe("Time window; defaults to 30d."),
      },
    },
    ({ org, repo, range }) =>
      userPrompt(
        lines(
          `Summarise the review history for account "${org}"` +
            (repo === undefined ? "" : `, repository ${repo}`) +
            (range === undefined ? "" : `, over the last ${range}`) +
            ".",
          "",
          "1. Call `review_trends` for the aggregates: totals, findings per agent and per category, the daily",
          "   series, and token usage with cost.",
          "2. Call `list_reviews` for the recent reviews, and `get_review` on any that stand out.",
          "3. Answer: what is reviewed most, which categories dominate, whether findings per review are rising",
          "   or falling, and where the cost goes.",
          "4. End with the two or three recurring problems worth fixing at the source rather than one PR at a time.",
        ),
      ),
  );
}
