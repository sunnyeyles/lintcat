import {
  memberships,
  organizations,
  users,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { and, asc, eq, isNull } from "drizzle-orm";

import { organizationPath } from "@/lib/paths";

export type OrganizationMembership = {
  organization: Organization;
  role: MembershipRole;
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

/** Every live organization the user belongs to, oldest membership first. */
export async function membershipsForUser(
  database: Database,
  githubId: number,
): Promise<OrganizationMembership[]> {
  return database
    .select({ organization: organizations, role: memberships.role })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(users.githubId, githubId),
        isNull(organizations.suspendedAt),
        isNull(organizations.uninstalledAt),
      ),
    )
    .orderBy(asc(memberships.id));
}
