import { saveRepoSettings, type Database, type RepoReviewMode } from "@pr-review/db";
import { z } from "zod";

import type { ModelKeyProvider } from "@/lib/model-key";

/** The three modes a repository's hosted reviews can run in, labelled for the form. */
export const REPO_REVIEW_MODES: Record<RepoReviewMode, string> = {
  off: "Off",
  label: "On the ai-review label",
  every_pr: "Every pull request",
};

/** The models a repo may choose per provider; a test keeps this in step with @pr-review/ai. */
export const REPO_MODEL_CHOICES: Record<ModelKeyProvider, readonly string[]> = {
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5", "claude-sonnet-4-5"],
  openai: ["gpt-5.6-luna", "gpt-5.6-luna-mini"],
};

// Radix Select cannot hold an empty value, so "use the provider's default" needs a name.
export const DEFAULT_MODEL_VALUE = "default";

const KNOWN_MODELS = new Set(Object.values(REPO_MODEL_CHOICES).flat());

export type RepoSettingsFormState =
  | { status: "idle" }
  | { status: "saved"; mode: RepoReviewMode; model: string | null; fixes: boolean }
  | { status: "error"; message: string };

const formSchema = z.object({
  mode: z.enum(Object.keys(REPO_REVIEW_MODES) as [RepoReviewMode, ...RepoReviewMode[]], {
    error: "Choose when hosted reviews run.",
  }),
  model: z
    .string()
    .trim()
    .optional()
    .transform((value) => (!value || value === DEFAULT_MODEL_VALUE ? null : value))
    .refine((value) => value === null || KNOWN_MODELS.has(value), {
      error: "Choose one of the offered models.",
    }),
  fixes: z.string().optional(),
});

interface RepoOwnerAccess {
  repoId: number;
  isOwner: boolean;
}

const NOT_OWNER: RepoSettingsFormState = {
  status: "error",
  message: "Only a repository owner can change these settings.",
};

export async function saveRepoSettingsForm(
  database: Database,
  access: RepoOwnerAccess,
  form: FormData,
): Promise<RepoSettingsFormState> {
  if (!access.isOwner) return NOT_OWNER;
  const parsed = formSchema.safeParse({
    mode: form.get("mode") ?? undefined,
    model: form.get("model") ?? undefined,
    fixes: form.get("fixes") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const saved = await saveRepoSettings(database, access.repoId, {
    mode: parsed.data.mode,
    model: parsed.data.model,
    fixes: parsed.data.fixes === "on",
  });
  return { status: "saved", mode: saved.mode, model: saved.model, fixes: saved.fixes };
}

/** The model options for a repo: its org key's provider's models, or all of them with no key. */
export function repoModelOptions(
  provider: ModelKeyProvider | undefined,
  saved: string | null,
): { value: string; label: string }[] {
  const ids = provider
    ? [...REPO_MODEL_CHOICES[provider]]
    : Object.values(REPO_MODEL_CHOICES).flat();
  // A model saved under a previous provider stays visible so the owner can see why reviews fail.
  if (saved !== null && !ids.includes(saved)) ids.push(saved);
  return [
    { value: DEFAULT_MODEL_VALUE, label: "Provider default" },
    ...ids.map((id) => ({ value: id, label: id })),
  ];
}
