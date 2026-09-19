"use server";

import { signIn, signOut } from "@/auth";

export async function signInWithGithub(): Promise<void> {
  await signIn("github", { redirectTo: "/" });
}

export async function signOutOfDashboard(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}
