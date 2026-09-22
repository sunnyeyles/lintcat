import { randomBytes } from "node:crypto";

import { MODEL_PROVIDERS } from "@pr-review/ai";
import {
  modelKeys,
  organizations,
  readModelKey,
  type Database,
  type Organization,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MODEL_KEY_PROVIDERS,
  removeModelKeyForm,
  saveModelKeyForm,
} from "@/lib/model-key";

const encryptionKey = randomBytes(32);
const API_KEY = "sk-ant-api03-abcdefghijklmnop-wxyz";

let database: Database;
let organization: Organization;

beforeEach(async () => {
  database = await createTestDatabase();
  [organization] = (await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning()) as [Organization];
});

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) if (value !== undefined) data.set(name, value);
  return data;
}

const owner = () => ({ organization, role: "owner" as const });
const member = () => ({ organization, role: "member" as const });

describe("saveModelKeyForm", () => {
  it("offers exactly the providers the reviewer can run", () => {
    expect(Object.keys(MODEL_KEY_PROVIDERS).sort()).toEqual([...MODEL_PROVIDERS].sort());
  });

  it("saves the key sealed and answers with only its last four characters", async () => {
    const state = await saveModelKeyForm(
      database,
      owner(),
      form({ provider: "anthropic", apiKey: `  ${API_KEY}  ` }),
      encryptionKey,
    );
    expect(state).toEqual({ status: "saved", provider: "anthropic", last4: "wxyz" });
    expect(JSON.stringify(state)).not.toContain("abcdefgh");
    expect(await readModelKey(database, organization.id, encryptionKey)).toEqual({
      provider: "anthropic",
      apiKey: API_KEY,
    });
  });

  it("refuses a member who is not an owner", async () => {
    const state = await saveModelKeyForm(
      database,
      member(),
      form({ provider: "anthropic", apiKey: API_KEY }),
      encryptionKey,
    );
    expect(state.status).toBe("error");
    expect(await database.select().from(modelKeys)).toEqual([]);
  });

  it("rejects an unknown provider or a blank or implausibly short key", async () => {
    for (const fields of [
      { provider: "cohere", apiKey: API_KEY },
      { provider: "openai", apiKey: "   " },
      { provider: "openai", apiKey: "short" },
      { apiKey: API_KEY },
    ]) {
      const state = await saveModelKeyForm(database, owner(), form(fields), encryptionKey);
      expect(state.status).toBe("error");
      if (state.status === "error") expect(state.message).not.toContain(API_KEY);
    }
    expect(await database.select().from(modelKeys)).toEqual([]);
  });
});

describe("removeModelKeyForm", () => {
  it("removes the key for an owner only", async () => {
    await saveModelKeyForm(
      database,
      owner(),
      form({ provider: "openai", apiKey: API_KEY }),
      encryptionKey,
    );
    expect((await removeModelKeyForm(database, member())).status).toBe("error");
    expect(await database.select().from(modelKeys)).toHaveLength(1);
    expect(await removeModelKeyForm(database, owner())).toEqual({ status: "removed" });
    expect(await database.select().from(modelKeys)).toEqual([]);
  });
});
