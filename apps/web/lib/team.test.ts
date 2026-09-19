import { teams, users, type Database } from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { teamForUser } from "@/lib/team";

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

describe("teamForUser", () => {
  it("returns the team the user belongs to", async () => {
    const inserted = await database
      .insert(teams)
      .values({ slug: "acme", name: "Acme", githubOrg: "acme" })
      .returning({ id: teams.id });
    const teamId = inserted[0]!.id;
    await database
      .insert(users)
      .values({ githubId: 1, login: "octocat", teamId });

    const team = await teamForUser(database, 1);

    expect(team).toMatchObject({ id: teamId, slug: "acme", name: "Acme" });
  });

  it("returns undefined for a user with no team", async () => {
    await database.insert(users).values({ githubId: 2, login: "hubot" });

    expect(await teamForUser(database, 2)).toBeUndefined();
  });

  it("returns undefined for a user who has never signed in", async () => {
    expect(await teamForUser(database, 99)).toBeUndefined();
  });

  it("does not leak another user's team", async () => {
    const inserted = await database
      .insert(teams)
      .values({ slug: "globex", name: "Globex" })
      .returning({ id: teams.id });
    await database.insert(users).values([
      { githubId: 3, login: "member", teamId: inserted[0]!.id },
      { githubId: 4, login: "outsider" },
    ]);

    expect(await teamForUser(database, 4)).toBeUndefined();
    const rows = await database.select().from(users).where(eq(users.githubId, 3));
    expect(rows[0]?.teamId).toBe(inserted[0]!.id);
  });
});
