import { db, type MembershipRole, type Organization } from "@pr-review/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { authorize } from "@/lib/authorize";
import { organizationPath, REQUEST_PATH_HEADER, signInPath } from "@/lib/paths";

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

export type OrganizationAccess = {
  session: AppSession;
  organization: Organization;
  role: MembershipRole;
};

/** Every organization page's guard: signed out goes to sign-in, anyone not allowed gets a 404. */
export const requireOrganization = cache(
  async (slug: string): Promise<OrganizationAccess> => {
    const session = await currentSession();
    if (!session) {
      const requested = (await headers()).get(REQUEST_PATH_HEADER);
      redirect(signInPath(requested ?? organizationPath(slug)));
    }
    const access = await authorize(db(), session, slug);
    if (access.status !== "allowed") notFound();
    return { session, organization: access.organization, role: access.role };
  },
);
