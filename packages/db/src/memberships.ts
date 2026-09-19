import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  memberships,
  organizations,
  users,
  type MembershipRole,
  type Organization,
  type User,
} from "./schema";

/** A GitHub user as a webhook payload or the members API describes them. */
export interface GithubAccount {
  githubId: number;
  login: string;
  avatarUrl: string | null;
}

/** Creates the user a member row needs; name and email stay as sign-in last wrote them. */
export async function upsertAccountUser(
  database: Database,
  account: GithubAccount,
): Promise<User> {
  const rows = await database
    .insert(users)
    .values({
      githubId: account.githubId,
      login: account.login,
      avatarUrl: account.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.githubId,
      set: {
        login: account.login,
        avatarUrl: sql`coalesce(excluded.avatar_url, ${users.avatarUrl})`,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error(`could not upsert github user ${account.login}`);
  return row;
}

export async function upsertMembership(
  database: Database,
  membership: { userId: number; organizationId: number; role: MembershipRole },
): Promise<void> {
  await database
    .insert(memberships)
    .values(membership)
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.organizationId],
      set: { role: membership.role, syncedAt: sql`now()` },
    });
}

/** Whether a membership existed and was deleted. */
export async function deleteMembership(
  database: Database,
  organizationId: number,
  githubUserId: number,
): Promise<boolean> {
  const user = database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubUserId));
  const deleted = await database
    .delete(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        inArray(memberships.userId, user),
      ),
    )
    .returning({ id: memberships.id });
  return deleted.length > 0;
}

export async function listOrganizationMembers(
  database: Database,
  organizationId: number,
): Promise<{ githubId: number; login: string; role: MembershipRole }[]> {
  return database
    .select({ githubId: users.githubId, login: users.login, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(memberships.id));
}

export async function findOrganizationByAccountId(
  database: Database,
  accountId: number,
): Promise<Organization | undefined> {
  const [row] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.githubAccountId, accountId))
    .limit(1);
  return row;
}

/** Every organization with a live App installation, suspended ones included. */
export async function listInstalledOrganizations(
  database: Database,
): Promise<Organization[]> {
  return database
    .select()
    .from(organizations)
    .where(isNotNull(organizations.installationId))
    .orderBy(asc(organizations.id));
}
