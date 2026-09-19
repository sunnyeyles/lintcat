import {
  memberships,
  organizations,
  users,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { and, eq, isNull } from "drizzle-orm";

export type Authorization =
  | { status: "allowed"; organization: Organization; role: MembershipRole }
  | { status: "not-found" };

const NOT_FOUND: Authorization = { status: "not-found" };

/** Unknown slug, suspended organization and non-member all give the same not-found. */
export async function authorize(
  database: Database,
  session: { githubId: number },
  slug: string,
): Promise<Authorization> {
  const [row] = await database
    .select({ organization: organizations, role: memberships.role })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(organizations.slug, slug.toLowerCase()),
        isNull(organizations.suspendedAt),
        eq(users.githubId, session.githubId),
      ),
    )
    .limit(1);
  return row ? { status: "allowed", ...row } : NOT_FOUND;
}
