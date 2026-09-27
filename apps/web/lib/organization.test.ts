import {
  memberships,
  organizations,
  repoAccess,
  repos,
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

  describe("collaborator accounts", () => {
    async function collaborate(userId: number, organization: Organization, removed = false) {
      const [repo] = await database
        .insert(repos)
        .values({
          organizationId: organization.id,
          owner: organization.slug,
          name: `repo-${organization.slug}`,
          private: true,
          removedAt: removed ? new Date() : null,
        })
        .returning({ id: repos.id });
      await database.insert(repoAccess).values({ userId, repoId: repo!.id, permission: "write" });
    }

    it("lists them after memberships, as collaborator", async () => {
      const acme = await insertOrganization(10, "acme");
      const alice = await insertOrganization(20, "alice");
      const mona = await insertUser(1, "mona");
      await join(mona, acme, "member");
      await collaborate(mona, alice);

      expect(await membershipsForUser(database, 1)).toEqual([
        { organization: acme, role: "member" },
        { organization: alice, role: "collaborator" },
      ]);
    });

    it("lists an account once, as its membership, when the user also has rows there", async () => {
      const acme = await insertOrganization(10, "acme");
      const mona = await insertUser(1, "mona");
      await join(mona, acme, "member");
      await collaborate(mona, acme);

      expect(await membershipsForUser(database, 1)).toEqual([
        { organization: acme, role: "member" },
      ]);
    });

    it("leaves out an account whose only granted repo is removed", async () => {
      const alice = await insertOrganization(20, "alice");
      await collaborate(await insertUser(1, "mona"), alice, true);

      expect(await membershipsForUser(database, 1)).toEqual([]);
    });

    it("forwards a user whose only account is a collaboration straight to it", async () => {
      const alice = await insertOrganization(20, "alice");
      await collaborate(await insertUser(1, "mona"), alice);

      expect(autoForwardPath(await membershipsForUser(database, 1))).toBe("/o/alice");
    });
  });
});
