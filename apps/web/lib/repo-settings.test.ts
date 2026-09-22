import { MODEL_PROVIDERS, modelChoicesFor } from "@pr-review/ai";
import {
  effectiveRepoSettings,
  organizations,
  repos,
  type Database,
  type Repo,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_VALUE,
  REPO_MODEL_CHOICES,
  repoModelOptions,
  saveRepoSettingsForm,
} from "@/lib/repo-settings";

let database: Database;
let repo: Repo;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  [repo] = (await database
    .insert(repos)
    .values({ organizationId: organization!.id, owner: "acme", name: "widgets" })
    .returning()) as [Repo];
});

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) if (value !== undefined) data.set(name, value);
  return data;
}

const asOwner = () => ({ repoId: repo.id, isOwner: true });
const asReader = () => ({ repoId: repo.id, isOwner: false });

describe("saveRepoSettingsForm", () => {
  it("offers exactly the models the worker accepts", () => {
    for (const provider of MODEL_PROVIDERS) {
      expect(REPO_MODEL_CHOICES[provider]).toEqual(modelChoicesFor(provider));
    }
  });

  it("saves mode, a model override and fixes for an owner", async () => {
    const state = await saveRepoSettingsForm(
      database,
      asOwner(),
      form({ mode: "every_pr", model: "  claude-sonnet-4-5  ", fixes: "on" }),
    );
    expect(state).toEqual({
      status: "saved",
      mode: "every_pr",
      model: "claude-sonnet-4-5",
      fixes: true,
    });
    expect(await effectiveRepoSettings(database, repo.id)).toEqual({
      mode: "every_pr",
      model: "claude-sonnet-4-5",
      fixes: true,
    });
  });

  it("treats a blank model as no override, and an absent checkbox as fixes off", async () => {
    const state = await saveRepoSettingsForm(
      database,
      asOwner(),
      form({ mode: "label", model: "   " }),
    );
    expect(state).toMatchObject({ status: "saved", mode: "label", model: null, fixes: false });
  });

  it("treats the default option as no override", async () => {
    await saveRepoSettingsForm(
      database,
      asOwner(),
      form({ mode: "label", model: "claude-sonnet-4-5" }),
    );
    const state = await saveRepoSettingsForm(
      database,
      asOwner(),
      form({ mode: "off", model: DEFAULT_MODEL_VALUE, fixes: "on" }),
    );
    expect(state).toMatchObject({ status: "saved", mode: "off", model: null, fixes: true });
    expect(await effectiveRepoSettings(database, repo.id)).toEqual({
      mode: "off",
      model: null,
      fixes: true,
    });
  });

  it("rejects a model no provider offers", async () => {
    const state = await saveRepoSettingsForm(
      database,
      asOwner(),
      form({ mode: "label", model: "not-a-real-model" }),
    );
    expect(state).toEqual({ status: "error", message: "Choose one of the offered models." });
    expect(await effectiveRepoSettings(database, repo.id)).toMatchObject({ model: null });
  });

  it("refuses a reader who is not a repository owner", async () => {
    const state = await saveRepoSettingsForm(
      database,
      asReader(),
      form({ mode: "off", model: "" }),
    );
    expect(state.status).toBe("error");
    expect(await effectiveRepoSettings(database, repo.id)).toEqual({
      mode: "label",
      model: null,
      fixes: false,
    });
  });

  it("rejects an unknown mode", async () => {
    const state = await saveRepoSettingsForm(database, asOwner(), form({ mode: "always" }));
    expect(state.status).toBe("error");
  });
});

describe("repoModelOptions", () => {
  it("offers the default and the key's provider's models", () => {
    expect(repoModelOptions("anthropic", null).map((option) => option.value)).toEqual([
      DEFAULT_MODEL_VALUE,
      ...REPO_MODEL_CHOICES.anthropic,
    ]);
  });

  it("offers every provider's models when the organization has no key", () => {
    expect(repoModelOptions(undefined, null)).toHaveLength(
      1 + Object.values(REPO_MODEL_CHOICES).flat().length,
    );
  });

  it("keeps a saved model from another provider visible", () => {
    const values = repoModelOptions("openai", "claude-sonnet-4-5").map((option) => option.value);
    expect(values).toContain("claude-sonnet-4-5");
  });
});
