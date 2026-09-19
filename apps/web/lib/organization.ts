import {
  memberships,
  organizations,
  users,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { and, asc, eq, isNull } from "drizzle-orm";

export type OrganizationMembership = {
  organization: Organization;
  role: MembershipRole;
};

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
    .where(and(eq(users.githubId, githubId), isNull(organizations.suspendedAt)))
    .orderBy(asc(memberships.id));
}
