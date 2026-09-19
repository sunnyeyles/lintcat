"use server";

import { signIn, signOut } from "@/auth";
import { safeCallbackUrl } from "@/lib/paths";

export async function signInWithGithub(form: FormData): Promise<void> {
  await signIn("github", { redirectTo: safeCallbackUrl(form.get("callbackUrl")) });
}

export async function signOutOfDashboard(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}
