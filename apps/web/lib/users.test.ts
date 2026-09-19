import {
  memberships,
  organizations,
  users,
  type Database,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { beforeEach, describe, expect, it } from "vitest";

import { upsertGithubUser } from "@/lib/users";

const profile = {
  id: 4_812,
  login: "octocat",
  name: "Mona Lisa",
  email: "mona@example.test",
  avatar_url: "https://avatars.example.test/octocat.png",
};

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

describe("upsertGithubUser", () => {
  it("inserts a user with no membership", async () => {
    const user = await upsertGithubUser(database, profile);

    expect(user).toMatchObject({
      githubId: 4_812,
      login: "octocat",
      name: "Mona Lisa",
      email: "mona@example.test",
      avatarUrl: "https://avatars.example.test/octocat.png",
    });
    expect(await database.select().from(memberships)).toEqual([]);
  });

  it("updates the github fields on a second sign-in", async () => {
    const first = await upsertGithubUser(database, profile);
    const second = await upsertGithubUser(database, {
      ...profile,
      login: "monalisa",
      name: null,
      email: null,
      avatar_url: null,
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      login: "monalisa",
      name: null,
      email: null,
      avatarUrl: null,
    });
    const rows = await database.select().from(users);
    expect(rows).toHaveLength(1);
  });

  it("keeps the memberships the user already had", async () => {
    const [organization] = await database
      .insert(organizations)
      .values({
        githubAccountId: 100,
        accountType: "organization",
        slug: "acme",
        name: "Acme",
      })
      .returning({ id: organizations.id });
    const user = await upsertGithubUser(database, profile);
    await database
      .insert(memberships)
      .values({ userId: user.id, organizationId: organization!.id, role: "owner" });

    const again = await upsertGithubUser(database, { ...profile, name: "Mona" });

    expect(again).toMatchObject({ id: user.id, name: "Mona" });
    expect(await database.select().from(memberships)).toEqual([
      expect.objectContaining({ userId: user.id, role: "owner" }),
    ]);
  });
});
