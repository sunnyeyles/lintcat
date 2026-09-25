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

import { autoForwardPath, membershipsForUser, ownsPersonalAccount } from "@/lib/organization";

describe("autoForwardPath", () => {
  const organization = { slug: "acme" } as Organization;
  const other = { slug: "globex" } as Organization;

  it("sends a user with exactly one organization straight to it", () => {
    expect(autoForwardPath([{ organization, role: "member" }])).toBe("/o/acme");
  });

  it("keeps the picker for none or several", () => {
    expect(autoForwardPath([])).toBeUndefined();
    expect(
      autoForwardPath([
        { organization, role: "owner" },
        { organization: other, role: "member" },
      ]),
    ).toBeUndefined();
  });
});

describe("ownsPersonalAccount", () => {
  const personal = { githubAccountId: 7, accountType: "user" } as Organization;
  const acme = { githubAccountId: 9, accountType: "organization" } as Organization;

  it("is true when the user's own account is among their accounts", () => {
    expect(
      ownsPersonalAccount(
        [
          { organization: acme, role: "member" },
          { organization: personal, role: "owner" },
        ],
        7,
      ),
    ).toBe(true);
  });

  it("is false with only organizations, or none", () => {
    expect(ownsPersonalAccount([{ organization: acme, role: "owner" }], 7)).toBe(false);
    expect(ownsPersonalAccount([], 7)).toBe(false);
  });
});

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
