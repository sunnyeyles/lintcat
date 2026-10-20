import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  findModelKeySummary,
  ModelKeyUnreadableError,
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

  it("AC17: a key sealed under another encryption key rejects with ModelKeyUnreadableError", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    await expect(readModelKey(database, organizationId, randomBytes(32))).rejects.toBeInstanceOf(
      ModelKeyUnreadableError,
    );
  });

  it("AC17: an unknown sealed format rejects with ModelKeyUnreadableError", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    await database.update(modelKeys).set({ sealedKey: Buffer.from([9, 1, 2, 3]) });
    await expect(readModelKey(database, organizationId, encryptionKey)).rejects.toBeInstanceOf(
      ModelKeyUnreadableError,
    );
  });

  it("AC17: another organization's copied key rejects with ModelKeyUnreadableError", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    const [other] = await database
      .insert(organizations)
      .values({ githubAccountId: 2, accountType: "organization", slug: "globex", name: "Globex" })
      .returning();
    const [row] = await database.select().from(modelKeys);
    await database.insert(modelKeys).values({ ...row!, id: undefined, organizationId: other!.id });
    await expect(readModelKey(database, other!.id, encryptionKey)).rejects.toBeInstanceOf(
      ModelKeyUnreadableError,
    );
  });

  it("AC17: the unreadable-key error does not carry the plaintext key", async () => {
    await saveModelKey(database, organizationId, { provider: "openai", apiKey: API_KEY }, encryptionKey);
    const error = await readModelKey(database, organizationId, randomBytes(32)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelKeyUnreadableError);
    expect(String((error as Error).message)).not.toContain(API_KEY);
  });

  it("AC17: no stored key still reads as undefined, not an error", async () => {
    expect(await readModelKey(database, organizationId, encryptionKey)).toBeUndefined();
  });
});
