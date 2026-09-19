import { teams, users, type Database } from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { eq } from "drizzle-orm";
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
  it("inserts a user with no team", async () => {
    const user = await upsertGithubUser(database, profile);

    expect(user).toMatchObject({
      githubId: 4_812,
      login: "octocat",
      name: "Mona Lisa",
      email: "mona@example.test",
      avatarUrl: "https://avatars.example.test/octocat.png",
      teamId: null,
      role: "member",
    });
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

  it("keeps the team and role the user already had", async () => {
    const inserted = await database
      .insert(teams)
      .values({ slug: "acme", name: "Acme" })
      .returning({ id: teams.id });
    const teamId = inserted[0]!.id;
    const user = await upsertGithubUser(database, profile);
    await database
      .update(users)
      .set({ teamId, role: "owner" })
      .where(eq(users.id, user.id));

    const again = await upsertGithubUser(database, { ...profile, name: "Mona" });

    expect(again).toMatchObject({ teamId, role: "owner", name: "Mona" });
  });
});
