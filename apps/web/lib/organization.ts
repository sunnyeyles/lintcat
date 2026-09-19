import {
  memberships,
  organizations,
  users,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { asc, eq } from "drizzle-orm";

export type OrganizationMembership = {
  organization: Organization;
  role: MembershipRole;
};

/** Every organization the user belongs to, oldest membership first. */
export async function membershipsForUser(
  database: Database,
  githubId: number,
): Promise<OrganizationMembership[]> {
  return database
    .select({ organization: organizations, role: memberships.role })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(users.githubId, githubId))
    .orderBy(asc(memberships.id));
}

// The oldest membership wins until pages are addressed by organization slug.
export async function currentMembershipForUser(
  database: Database,
  githubId: number,
): Promise<OrganizationMembership | undefined> {
  const [first] = await membershipsForUser(database, githubId);
  return first;
}
