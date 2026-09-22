import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  findModelKeySummary,
  readModelKey,
  removeModelKey,
  saveModelKey,
} from "./model-keys";
import { modelKeys, organizations } from "./schema";
import { createTestDatabase } from "./test-database";

const encryptionKey = randomBytes(32);
const API_KEY = "sk-ant-api03-abcdefghijklmnop-wxyz";

let database: Database;
let organizationId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  organizationId = organization!.id;
});

describe("model keys", () => {
  it("stores the key sealed, and shows back only its last four characters", async () => {
    const summary = await saveModelKey(
      database,
      organizationId,
      { provider: "anthropic", apiKey: API_KEY },
      encryptionKey,
    );
    expect(summary).toMatchObject({ provider: "anthropic", last4: "wxyz" });
    expect(JSON.stringify(summary)).not.toContain("abcdefgh");

    const [row] = await database.select().from(modelKeys);
    expect(Buffer.from(row!.sealedKey).toString("latin1")).not.toContain("sk-ant");
    expect(await findModelKeySummary(database, organizationId)).toMatchObject({
      provider: "anthropic",
      last4: "wxyz",
    });
  });

  it("opens the key for the worker with the same encryption key only", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    expect(await readModelKey(database, organizationId, encryptionKey)).toEqual({
      provider: "openai",
      apiKey: API_KEY,
    });
    await expect(readModelKey(database, organizationId, randomBytes(32))).rejects.toThrow();
  });

  it("replaces the key in place", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    await saveModelKey(
      database,
      organizationId,
      { provider: "anthropic", apiKey: "sk-new-key-0000-9876" },
      encryptionKey,
    );
    expect(await database.select().from(modelKeys)).toHaveLength(1);
    expect(await readModelKey(database, organizationId, encryptionKey)).toEqual({
      provider: "anthropic",
      apiKey: "sk-new-key-0000-9876",
    });
  });

  it("removes the key", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    expect(await removeModelKey(database, organizationId)).toBe(true);
    expect(await removeModelKey(database, organizationId)).toBe(false);
    expect(await findModelKeySummary(database, organizationId)).toBeUndefined();
    expect(await readModelKey(database, organizationId, encryptionKey)).toBeUndefined();
  });

  it("will not open one organization's key as another's", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    const [other] = await database
      .insert(organizations)
      .values({ githubAccountId: 2, accountType: "organization", slug: "globex", name: "Globex" })
      .returning();
    const [row] = await database.select().from(modelKeys);
    await database.insert(modelKeys).values({ ...row!, id: undefined, organizationId: other!.id });
    await expect(readModelKey(database, other!.id, encryptionKey)).rejects.toThrow();
  });

  it("rejects an empty key", async () => {
    await expect(
      saveModelKey(database, organizationId, { provider: "openai", apiKey: "  " }, encryptionKey),
    ).rejects.toThrow();
  });
});
