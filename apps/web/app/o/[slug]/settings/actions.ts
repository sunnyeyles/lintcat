"use server";

import { db, modelKeyEncryptionKey } from "@pr-review/db";
import { revalidatePath } from "next/cache";

import {
  removeModelKeyForm,
  saveModelKeyForm,
  type ModelKeyFormState,
} from "@/lib/model-key";
import { organizationPath } from "@/lib/paths";
import { requireOrganization } from "@/lib/session";

// An action is its own endpoint, so each one re-checks the session and the owner role.
export async function saveModelKeyAction(
  slug: string,
  _previous: ModelKeyFormState,
  form: FormData,
): Promise<ModelKeyFormState> {
  const access = await requireOrganization(slug);
  const state = await saveModelKeyForm(db(), access, form, modelKeyEncryptionKey());
  if (state.status === "saved") revalidatePath(organizationPath(slug, "/settings"));
  return state;
}

export async function removeModelKeyAction(
  slug: string,
  _previous: ModelKeyFormState,
): Promise<ModelKeyFormState> {
  const access = await requireOrganization(slug);
  const state = await removeModelKeyForm(db(), access);
  if (state.status === "removed") revalidatePath(organizationPath(slug, "/settings"));
  return state;
}
