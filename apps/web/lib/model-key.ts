import {
  removeModelKey,
  saveModelKey,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { MODEL_PROVIDERS, type ModelProvider } from "@pr-review/schemas";
import { z } from "zod";

import { firstIssue } from "@/lib/forms";

/** Display names for the providers a hosted review can run on. */
export const MODEL_KEY_PROVIDERS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
} as const satisfies Record<ModelProvider, string>;
export type ModelKeyProvider = ModelProvider;

export function isModelKeyProvider(value: string | undefined): value is ModelKeyProvider {
  return value !== undefined && (MODEL_PROVIDERS as readonly string[]).includes(value);
}

// What the form sees after a submit; it never carries the key back to the browser.
export type ModelKeyFormState =
  | { status: "idle" }
  | { status: "saved"; provider: string; last4: string }
  | { status: "removed" }
  | { status: "error"; message: string };

const formSchema = z.object({
  provider: z.enum(MODEL_PROVIDERS, {
    error: "Choose a provider.",
  }),
  apiKey: z
    .string({ error: "Paste an API key." })
    .trim()
    .min(8, { error: "That does not look like an API key." })
    .max(512, { error: "That does not look like an API key." }),
});

interface OwnerAccess {
  organization: Organization;
  role: MembershipRole;
}

const NOT_OWNER: ModelKeyFormState = {
  status: "error",
  message: "Only an owner of this account can change the model key.",
};

export async function saveModelKeyForm(
  database: Database,
  { organization, role }: OwnerAccess,
  form: FormData,
  encryptionKey: Uint8Array,
): Promise<ModelKeyFormState> {
  if (role !== "owner") return NOT_OWNER;
  const parsed = formSchema.safeParse({
    provider: form.get("provider") ?? undefined,
    apiKey: form.get("apiKey") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssue(parsed) };
  }
  const saved = await saveModelKey(database, organization.id, parsed.data, encryptionKey);
  return { status: "saved", provider: saved.provider, last4: saved.last4 };
}

export async function removeModelKeyForm(
  database: Database,
  { organization, role }: OwnerAccess,
): Promise<ModelKeyFormState> {
  if (role !== "owner") return NOT_OWNER;
  await removeModelKey(database, organization.id);
  return { status: "removed" };
}

export function providerLabel(provider: string): string {
  return MODEL_KEY_PROVIDERS[provider as ModelKeyProvider] ?? provider;
}
