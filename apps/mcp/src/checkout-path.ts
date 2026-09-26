import path from "node:path";

import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { isWithin, repositoryRoot } from "#src/local-git-client";

/** The root holding the server's working directory, else the first the client named. */
function defaultRoot(roots: readonly string[], cwd: string): string {
  return roots.find((root) => isWithin(root, cwd)) ?? roots[0]!;
}

/** Where a tool's `repoPath` points, gated by the client's roots; ungated when it serves none. */
export async function resolveCheckoutPath(
  environment: McpEnvironment,
  client: ConnectedClient,
  repoPath: string | undefined,
): Promise<string> {
  const roots = (await client.roots()).map((root) => path.resolve(root));
  const cwd = path.resolve(environment.cwd);
  if (roots.length === 0) {
    return path.resolve(cwd, repoPath ?? ".");
  }
  if (repoPath === undefined) {
    return defaultRoot(roots, cwd);
  }
  const resolved = path.resolve(cwd, repoPath);
  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error(
      `${resolved} is outside the workspace you have open. Allowed: ${roots.join(", ")}.`,
    );
  }
  return resolved;
}

/** The checkout root holding the tool's `repoPath`, with symlinks resolved. */
export async function checkoutRoot(
  environment: McpEnvironment,
  client: ConnectedClient,
  repoPath: string | undefined,
): Promise<string> {
  return repositoryRoot(await resolveCheckoutPath(environment, client, repoPath));
}
