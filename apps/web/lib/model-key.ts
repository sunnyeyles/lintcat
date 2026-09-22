import {
  removeModelKey,
  saveModelKey,
  type Database,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { z } from "zod";

/** The providers a hosted review can run on; a test keeps this in step with @pr-review/ai. */
export const MODEL_KEY_PROVIDERS = { anthropic: "Anthropic", openai: "OpenAI" } as const;
export type ModelKeyProvider = keyof typeof MODEL_KEY_PROVIDERS;

// What the form sees after a submit; it never carries the key back to the browser.
export type ModelKeyFormState =
  | { status: "idle" }
  | { status: "saved"; provider: string; last4: string }
  | { status: "removed" }
  | { status: "error"; message: string };

const formSchema = z.object({
  provider: z.enum(Object.keys(MODEL_KEY_PROVIDERS) as [ModelKeyProvider, ...ModelKeyProvider[]], {
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
  message: "Only an organization owner can change the model key.",
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
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
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
