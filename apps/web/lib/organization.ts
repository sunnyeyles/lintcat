import {
  memberships,
  organizations,
  repoAccess,
  repos,
  users,
  type AccessRole,
  type Database,
  type Organization,
} from "@pr-review/db";
import { and, asc, eq, isNull } from "drizzle-orm";

import { organizationPath } from "@/lib/paths";

export type OrganizationMembership = {
  organization: Organization;
  role: AccessRole;
};

/** Where the picker sends a user with exactly one organization; the picker itself otherwise. */
export function autoForwardPath(
  list: readonly OrganizationMembership[],
): string | undefined {
  return list.length === 1 ? organizationPath(list[0]!.organization.slug) : undefined;
}

export function ownsPersonalAccount(
  list: readonly OrganizationMembership[],
  githubId: number,
): boolean {
  return list.some(({ organization }) => organization.githubAccountId === githubId);
}

/** Every live account the user belongs to, oldest membership first, then those they only collaborate in. */
export async function membershipsForUser(
  database: Database,
  githubId: number,
): Promise<OrganizationMembership[]> {
  const live = and(isNull(organizations.suspendedAt), isNull(organizations.uninstalledAt));
  const member = await database
    .select({ organization: organizations, role: memberships.role })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(users.githubId, githubId), live))
    .orderBy(asc(memberships.id));
  const collaborator = await database
    .selectDistinct({ organization: organizations })
    .from(users)
    .innerJoin(repoAccess, eq(repoAccess.userId, users.id))
    .innerJoin(repos, and(eq(repos.id, repoAccess.repoId), isNull(repos.removedAt)))
    .innerJoin(organizations, eq(organizations.id, repos.organizationId))
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizations.id)),
    )
    .where(and(eq(users.githubId, githubId), isNull(memberships.id), live))
    .orderBy(asc(organizations.id));
  return [
    ...member,
    ...collaborator.map(({ organization }) => ({ organization, role: "collaborator" as const })),
  ];
}
