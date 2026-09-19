import {
  memberships,
  organizations,
  readableRepos,
  repos,
  users,
  type Database,
  type MembershipRole,
  type Organization,
  type ReadableRepo,
  type Repo,
} from "@pr-review/db";
import { and, eq, isNull } from "drizzle-orm";

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
  | { status: "not-found" };

const NOT_FOUND: Authorization = { status: "not-found" };

/** Unknown slug, suspended or uninstalled organization, non-member and unreadable repo all give the same not-found. */
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
  if (!row) return NOT_FOUND;
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
