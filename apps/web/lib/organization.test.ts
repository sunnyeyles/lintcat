import {
  memberships,
  organizations,
  users,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { membershipsForUser } from "@/lib/organization";

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

async function insertOrganization(
  githubAccountId: number,
  slug: string,
): Promise<Organization> {
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId, accountType: "organization", slug, name: slug })
    .returning();
  return organization!;
}

async function insertUser(githubId: number, login: string): Promise<number> {
  const [user] = await database
    .insert(users)
    .values({ githubId, login })
    .returning({ id: users.id });
  return user!.id;
}

async function join(
  userId: number,
  organization: Organization,
  role: MembershipRole,
): Promise<void> {
  await database
    .insert(memberships)
    .values({ userId, organizationId: organization.id, role });
}

describe("membershipsForUser", () => {
  it("reads back one user's memberships in two organizations with different roles", async () => {
    const acme = await insertOrganization(10, "acme");
    const globex = await insertOrganization(20, "globex");
    const mona = await insertUser(1, "mona");
    await join(mona, acme, "owner");
    await join(mona, globex, "member");

    const found = await membershipsForUser(database, 1);

    expect(found).toEqual([
      { organization: acme, role: "owner" },
      { organization: globex, role: "member" },
    ]);
  });

  it("is empty for a user with no membership or who has never signed in", async () => {
    await insertUser(2, "hubot");

    expect(await membershipsForUser(database, 2)).toEqual([]);
    expect(await membershipsForUser(database, 99)).toEqual([]);
  });

  it("does not leak another user's organizations", async () => {
    const acme = await insertOrganization(10, "acme");
    const member = await insertUser(3, "member");
    await insertUser(4, "outsider");
    await join(member, acme, "member");

    expect(await membershipsForUser(database, 4)).toEqual([]);
    expect(await membershipsForUser(database, 3)).toHaveLength(1);
  });

  it("leaves out a suspended organization", async () => {
    const acme = await insertOrganization(10, "acme");
    const globex = await insertOrganization(20, "globex");
    const mona = await insertUser(1, "mona");
    await join(mona, acme, "owner");
    await join(mona, globex, "member");
    await database
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.id, acme.id));

    expect(await membershipsForUser(database, 1)).toEqual([
      { organization: globex, role: "member" },
    ]);
  });
});
