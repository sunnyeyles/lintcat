import { db, type MembershipRole, type Organization, type ReadableRepo } from "@pr-review/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { authorize } from "@/lib/authorize";
import { appDomain } from "@/lib/host";
import { organizationPath, REQUEST_PATH_HEADER, signInUrl } from "@/lib/paths";

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
  readableRepos: ReadableRepo[];
};

/** Every organization page's guard: signed out goes to sign-in, anyone not allowed gets a 404. */
export const requireOrganization = cache(
  async (slug: string): Promise<OrganizationAccess> => {
    const session = await currentSession();
    if (!session) {
      const requested = (await headers()).get(REQUEST_PATH_HEADER);
      redirect(signInUrl(requested ?? organizationPath(slug), appDomain()));
    }
    const access = await authorize(db(), session, slug);
    if (access.status !== "allowed") notFound();
    const { organization, role, readableRepos } = access;
    return { session, organization, role, readableRepos };
  },
);
