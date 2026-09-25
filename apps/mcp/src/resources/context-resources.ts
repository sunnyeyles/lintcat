import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpEnvironment } from "#src/environment";
import { readWorkingTreeFile } from "#src/local-git-client";
import { readStoredReview } from "#src/review-history";

const REVIEW_RESOURCE_TEMPLATE = "pr-review://review/{org}/{id}";
const FILE_RESOURCE_TEMPLATE = "pr-review://file/{+path}";

const RESOURCE_FORMS = [REVIEW_RESOURCE_TEMPLATE, FILE_RESOURCE_TEMPLATE].join(", ");

export function reviewResourceUri(org: string, id: number): string {
  return `pr-review://review/${encodeURIComponent(org)}/${id}`;
}

type Variables = Record<string, string | string[] | undefined>;

function variable(variables: Variables, name: string, uri: URL): string {
  const raw = variables[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") {
    throw new Error(`${uri.toString()} is missing "${name}". Valid resource URIs: ${RESOURCE_FORMS}.`);
  }
  return decodeURIComponent(value);
}

function jsonResource(uri: URL, value: unknown): ReadResourceResult {
  return {
    contents: [
      { uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(value, null, 2) },
    ],
  };
}

export function registerContextResources(
  server: McpServer,
  environment: McpEnvironment,
  githubId: () => Promise<number>,
): void {
  server.registerResource(
    "stored_review",
    new ResourceTemplate(REVIEW_RESOURCE_TEMPLATE, { list: undefined }),
    {
      title: "A stored review",
      description:
        "One review stored by the dashboard, with every finding, as `get_review` " +
        "returns it. `org` is the account slug and `id` the review id that list_reviews links to. " +
        "Only repositories your GitHub account can read resolve.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const org = variable(variables, "org", uri);
      const id = variable(variables, "id", uri);
      if (!/^\d+$/.test(id)) {
        throw new Error(`${uri.toString()} has a non-numeric review id "${id}"; expected ${REVIEW_RESOURCE_TEMPLATE}.`);
      }
      return jsonResource(uri, await readStoredReview(environment, githubId, org, Number(id)));
    },
  );

  server.registerResource(
    "checkout_file",
    new ResourceTemplate(FILE_RESOURCE_TEMPLATE, { list: undefined }),
    {
      title: "A file in the checkout",
      description:
        "One file of the checkout the server runs in, read from the working tree as it is on disk. " +
        "`path` is repository-relative; anything outside the checkout is refused.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const file = variable(variables, "path", uri);
      try {
        const { text } = await readWorkingTreeFile(environment.cwd, file);
        return { contents: [{ uri: uri.toString(), mimeType: "text/plain", text }] };
      } catch (error: unknown) {
        throw new Error(`Cannot read ${uri.toString()}: ${(error as Error).message}`);
      }
    },
  );
}
