"use server";

import { db } from "@pr-review/db";
import { revalidatePath } from "next/cache";

import { organizationPath } from "@/lib/paths";
import { saveRepoSettingsForm, type RepoSettingsFormState } from "@/lib/repo-settings";
import { requireRepo } from "@/lib/session";

// An action is its own endpoint, so it re-checks the session and the repo owner role.
export async function saveRepoSettingsAction(
  slug: string,
  owner: string,
  name: string,
  _previous: RepoSettingsFormState,
  form: FormData,
): Promise<RepoSettingsFormState> {
  const { repo } = await requireRepo(slug, owner, name);
  const state = await saveRepoSettingsForm(
    db(),
    { repoId: repo.id, isOwner: repo.isOwner },
    form,
  );
  if (state.status === "saved") {
    revalidatePath(organizationPath(slug, `/repos/${owner}/${name}/settings`));
  }
  return state;
}
