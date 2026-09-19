import { db } from "@pr-review/db";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  currentMembershipForUser,
  type OrganizationMembership,
} from "@/lib/organization";

/** What a page needs about the signed-in user; `githubId` keys the `users` row. */
export type AppSession = {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export async function currentSession(): Promise<AppSession | undefined> {
  const session = await auth();
  if (session?.githubId === undefined || session.login === undefined) {
    return undefined;
  }
  return {
    githubId: session.githubId,
    login: session.login,
    name: session.user?.name ?? null,
    avatarUrl: session.user?.image ?? null,
  };
}

export async function currentMembership(
  session: AppSession,
): Promise<OrganizationMembership | undefined> {
  return currentMembershipForUser(db(), session.githubId);
}

/** `/sign-in` explains both the signed-out and the no-organization state. */
export async function requireMembership(): Promise<
  OrganizationMembership & { session: AppSession }
> {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const membership = await currentMembership(session);
  if (!membership) redirect("/sign-in");
  return { session, ...membership };
}
