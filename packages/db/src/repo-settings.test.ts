import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  effectiveRepoSettings,
  findRepoSettings,
  saveRepoSettings,
} from "./repo-settings";
import { organizations, repoSettings, repos } from "./schema";
import { createTestDatabase } from "./test-database";

let database: Database;
let repoId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  const [repo] = await database
    .insert(repos)
    .values({ organizationId: organization!.id, owner: "acme", name: "widgets" })
    .returning();
  repoId = repo!.id;
});

describe("effectiveRepoSettings", () => {
  it("defaults to every pull request, no model override, and fixes off with no row", async () => {
    expect(await findRepoSettings(database, repoId)).toBeUndefined();
    expect(await effectiveRepoSettings(database, repoId)).toEqual({
      mode: "every_pr",
      model: null,
      fixes: false,
    });
  });

  it("reflects a saved row once one exists", async () => {
    await saveRepoSettings(database, repoId, {
      mode: "label",
      model: "claude-sonnet-4-5",
      fixes: true,
    });
    expect(await effectiveRepoSettings(database, repoId)).toEqual({
      mode: "label",
      model: "claude-sonnet-4-5",
      fixes: true,
    });
  });
});

describe("saveRepoSettings", () => {
  it("creates a row on first save", async () => {
    const saved = await saveRepoSettings(database, repoId, {
      mode: "off",
      model: null,
      fixes: false,
    });
    expect(saved).toMatchObject({ repoId, mode: "off", model: null, fixes: false });
    expect(await findRepoSettings(database, repoId)).toMatchObject({ mode: "off" });
  });

  it("replaces the row on a second save, rather than adding one", async () => {
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: false });
    await saveRepoSettings(database, repoId, {
      mode: "every_pr",
      model: "gpt-5.6-luna",
      fixes: true,
    });
    const found = await findRepoSettings(database, repoId);
    expect(found).toMatchObject({
      mode: "every_pr",
      model: "gpt-5.6-luna",
      fixes: true,
    });
    expect(
      await database.select().from(repoSettings).where(eq(repoSettings.repoId, repoId)),
    ).toHaveLength(1);
  });

  it("clears a model override by saving null", async () => {
    await saveRepoSettings(database, repoId, {
      mode: "label",
      model: "claude-sonnet-4-5",
      fixes: false,
    });
    await saveRepoSettings(database, repoId, { mode: "label", model: null, fixes: false });
    expect(await findRepoSettings(database, repoId)).toMatchObject({ model: null });
  });
});
