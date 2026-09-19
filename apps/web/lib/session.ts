import { db, type Team } from "@pr-review/db";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { teamForUser } from "@/lib/team";

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

export async function currentTeam(
  session: AppSession,
): Promise<Team | undefined> {
  return teamForUser(db(), session.githubId);
}

/** `/sign-in` explains both the signed-out and the no-team state. */
export async function requireTeam(): Promise<{
  session: AppSession;
  team: Team;
}> {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const team = await currentTeam(session);
  if (!team) redirect("/sign-in");
  return { session, team };
}
