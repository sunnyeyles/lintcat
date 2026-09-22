import {
  authorize,
  db,
  type MembershipRole,
  type Organization,
  type ReadableRepo,
  type Repo,
} from "@pr-review/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { appDomain } from "@/lib/host";
import {
  organizationPath,
  renamedOrganizationUrl,
  REQUEST_PATH_HEADER,
  signInUrl,
} from "@/lib/paths";

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

/** Every organization page's guard: signed out goes to sign-in, a retired slug to the current one, else 404. */
export const requireOrganization = cache(
  async (slug: string): Promise<OrganizationAccess> => {
    const session = await currentSession();
    if (!session) {
      const requested = (await headers()).get(REQUEST_PATH_HEADER);
      redirect(signInUrl(requested ?? organizationPath(slug), appDomain()));
    }
    const access = await authorize(db(), session, slug);
    if (access.status === "redirect") {
      const requested = (await headers()).get(REQUEST_PATH_HEADER);
      redirect(renamedOrganizationUrl(requested, access.slug, appDomain()));
    }
    if (access.status !== "allowed") notFound();
    const { organization, role, readableRepos } = access;
    return { session, organization, role, readableRepos };
  },
);

export type RepoAccess = {
  session: AppSession;
  organization: Organization;
  role: MembershipRole;
  repo: Repo & { isOwner: boolean };
};

/** A repository page's guard: same as `requireOrganization`, narrowed to one readable repo. */
export const requireRepo = cache(
  async (slug: string, owner: string, name: string): Promise<RepoAccess> => {
    const session = await currentSession();
    if (!session) {
      const requested = (await headers()).get(REQUEST_PATH_HEADER);
      redirect(signInUrl(requested ?? organizationPath(slug), appDomain()));
    }
    const access = await authorize(db(), session, slug, { owner, name });
    if (access.status === "redirect") {
      const requested = (await headers()).get(REQUEST_PATH_HEADER);
      redirect(renamedOrganizationUrl(requested, access.slug, appDomain()));
    }
    if (access.status !== "allowed" || !access.repo) notFound();
    const { organization, role, repo } = access;
    return { session, organization, role, repo };
  },
);
