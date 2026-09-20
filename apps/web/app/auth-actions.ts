"use server";

import { signIn, signOut } from "@/auth";
import { appDomain } from "@/lib/host";
import { apexUrl, safeCallbackUrl, SIGN_IN_PATH } from "@/lib/paths";
import { requestLocation } from "@/lib/request";

export async function signInWithGithub(form: FormData): Promise<void> {
  const redirectTo = safeCallbackUrl(form.get("callbackUrl"), appDomain());
  await signIn("github", { redirectTo });
}

export async function signOutOfDashboard(): Promise<void> {
  const { host, protocol } = await requestLocation();
  await signOut({ redirectTo: apexUrl(SIGN_IN_PATH, host, protocol, appDomain()) });
}
