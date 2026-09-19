import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "./client";
import { readableRepos, type ReadableRepo } from "./repo-access";
import {
  memberships,
  organizations,
  repos,
  users,
  type MembershipRole,
  type Organization,
  type Repo,
} from "./schema";
import { findSlugRedirect } from "./slugs";

export type Authorization =
  | {
      status: "allowed";
      organization: Organization;
      role: MembershipRole;
      /** Every repo query filters by this; an absent repo is not-found. */
      readableRepos: ReadableRepo[];
      /** Set when a repo was asked for. */
      repo?: Repo & { isOwner: boolean };
    }
  | { status: "redirect"; slug: string }
  | { status: "not-found" };

const NOT_FOUND: Authorization = { status: "not-found" };

// Unknown slug, suspended or uninstalled organization, non-member and unreadable repo all give the same not-found.
// A retired slug redirects anyone: that reveals only the rename, and the target still 404s for non-members.
export async function authorize(
  database: Database,
  session: { githubId: number },
  slug: string,
  repo?: { owner: string; name: string },
): Promise<Authorization> {
  const [row] = await database
    .select({ organization: organizations, role: memberships.role, userId: users.id })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(organizations.slug, slug.toLowerCase()),
        isNull(organizations.suspendedAt),
        isNull(organizations.uninstalledAt),
        eq(users.githubId, session.githubId),
      ),
    )
    .limit(1);
  if (!row) {
    const current = await findSlugRedirect(database, slug);
    return current ? { status: "redirect", slug: current } : NOT_FOUND;
  }
  const { organization, role, userId } = row;
  const readable = await readableRepos(database, {
    organizationId: organization.id,
    userId,
    role,
  });
  const allowed = { status: "allowed" as const, organization, role, readableRepos: readable };
  if (!repo) return allowed;

  const [found] = await database
    .select()
    .from(repos)
    .where(
      and(
        eq(repos.organizationId, organization.id),
        eq(repos.owner, repo.owner),
        eq(repos.name, repo.name),
      ),
    )
    .limit(1);
  const access = found && readable.find((entry) => entry.id === found.id);
  return found && access ? { ...allowed, repo: { ...found, isOwner: access.isOwner } } : NOT_FOUND;
}
