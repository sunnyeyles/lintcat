"use server";

import { signIn, signOut } from "@/auth";
import { appDomain } from "@/lib/host";
import { safeCallbackUrl } from "@/lib/paths";

export async function signInWithGithub(form: FormData): Promise<void> {
  const redirectTo = safeCallbackUrl(form.get("callbackUrl"), appDomain());
  await signIn("github", { redirectTo });
}

export async function signOutOfDashboard(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}
