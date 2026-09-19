import {
  memberships,
  organizations,
  users,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { beforeEach, describe, expect, it } from "vitest";

import { authorize } from "@/lib/authorize";

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

async function insertOrganization(
  githubAccountId: number,
  slug: string,
  suspendedAt: Date | null = null,
): Promise<Organization> {
  const [organization] = await database
    .insert(organizations)
    .values({
      githubAccountId,
      accountType: "organization",
      slug,
      name: slug,
      suspendedAt,
    })
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

const mona = { githubId: 1 };
const outsider = { githubId: 2 };

describe("authorize", () => {
  it("allows a member and returns the organization with their role", async () => {
    const acme = await insertOrganization(10, "acme");
    await join(await insertUser(1, "mona"), acme, "member");

    expect(await authorize(database, mona, "acme")).toEqual({
      status: "allowed",
      organization: acme,
      role: "member",
    });
  });

  it("gives a non-member and an unknown slug the identical not-found", async () => {
    const acme = await insertOrganization(10, "acme");
    await join(await insertUser(1, "mona"), acme, "owner");
    await insertUser(2, "outsider");

    const nonMember = await authorize(database, outsider, "acme");
    const unknownSlug = await authorize(database, mona, "no-such-org");

    expect(nonMember).toEqual({ status: "not-found" });
    expect(unknownSlug).toStrictEqual(nonMember);
  });

  it("gives a user who never signed in the same not-found", async () => {
    await insertOrganization(10, "acme");

    expect(await authorize(database, { githubId: 99 }, "acme")).toEqual({
      status: "not-found",
    });
  });

  it("returns each organization's own role for one user in two organizations", async () => {
    const acme = await insertOrganization(10, "acme");
    const globex = await insertOrganization(20, "globex");
    const user = await insertUser(1, "mona");
    await join(user, acme, "owner");
    await join(user, globex, "member");

    expect(await authorize(database, mona, "acme")).toEqual({
      status: "allowed",
      organization: acme,
      role: "owner",
    });
    expect(await authorize(database, mona, "globex")).toEqual({
      status: "allowed",
      organization: globex,
      role: "member",
    });
  });

  it("gives a member of a suspended organization the same not-found", async () => {
    const acme = await insertOrganization(10, "acme", new Date());
    await join(await insertUser(1, "mona"), acme, "owner");

    expect(await authorize(database, mona, "acme")).toEqual({ status: "not-found" });
  });

  it("matches the slug case-insensitively", async () => {
    const acme = await insertOrganization(10, "acme");
    await join(await insertUser(1, "mona"), acme, "member");

    expect(await authorize(database, mona, "Acme")).toMatchObject({
      status: "allowed",
    });
  });
});
