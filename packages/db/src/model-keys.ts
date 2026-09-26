import { eq } from "drizzle-orm";

import type { Database } from "./client";
import { modelKeys } from "./schema";
import { openSecret, sealSecret } from "./secret-box";

export interface ModelKeyInput {
  provider: string;
  apiKey: string;
}

/** What the dashboard may show: never the key itself. */
export interface ModelKeySummary {
  provider: string;
  last4: string;
  updatedAt: Date;
}

// Binds each ciphertext to its organization, so a copied row will not open.
const context = (organizationId: number) => `model-key:${organizationId}`;

const summaryColumns = {
  provider: modelKeys.provider,
  last4: modelKeys.last4,
  updatedAt: modelKeys.updatedAt,
};

export async function saveModelKey(
  database: Database,
  organizationId: number,
  input: ModelKeyInput,
  encryptionKey: Uint8Array,
): Promise<ModelKeySummary> {
  const apiKey = input.apiKey.trim();
  if (apiKey === "") throw new Error("model key is empty");
  const values = {
    organizationId,
    provider: input.provider,
    sealedKey: sealSecret(encryptionKey, apiKey, context(organizationId)),
    last4: apiKey.slice(-4),
  };
  const [row] = await database
    .insert(modelKeys)
    .values(values)
    .onConflictDoUpdate({
      target: modelKeys.organizationId,
      set: values,
    })
    .returning(summaryColumns);
  if (!row) throw new Error("model key upsert returned no row");
  return row;
}

/** Whether a key existed and was removed. */
export async function removeModelKey(
  database: Database,
  organizationId: number,
): Promise<boolean> {
  const removed = await database
    .delete(modelKeys)
    .where(eq(modelKeys.organizationId, organizationId))
    .returning({ id: modelKeys.id });
  return removed.length > 0;
}

export async function findModelKeySummary(
  database: Database,
  organizationId: number,
): Promise<ModelKeySummary | undefined> {
  const [row] = await database
    .select(summaryColumns)
    .from(modelKeys)
    .where(eq(modelKeys.organizationId, organizationId))
    .limit(1);
  return row;
}

/** The plaintext key, for the worker only. Throws when it cannot be opened. */
export async function readModelKey(
  database: Database,
  organizationId: number,
  encryptionKey: Uint8Array,
): Promise<ModelKeyInput | undefined> {
  const [row] = await database
    .select({ provider: modelKeys.provider, sealedKey: modelKeys.sealedKey })
    .from(modelKeys)
    .where(eq(modelKeys.organizationId, organizationId))
    .limit(1);
  if (!row) return undefined;
  return {
    provider: row.provider,
    apiKey: openSecret(encryptionKey, row.sealedKey, context(organizationId)),
  };
}
