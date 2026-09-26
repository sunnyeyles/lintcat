import { withWriteDatabase } from "@pr-review/db";
import { Button, EmptyState } from "@pr-review/design";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";
import { Clock, Link2Off, MailCheck, ShieldOff, UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { signOutOfDashboard } from "@/app/auth-actions";
import { PageHeader } from "@/components/shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { githubApp, INSTALL_APP_URL } from "@/lib/github-app";
import { appDomain } from "@/lib/host";
import { completeSetup, setupRequest, type SetupResult } from "@/lib/installation";
import { DASHBOARD_PATH, organizationPath, signInUrl } from "@/lib/paths";
import type { SearchParams } from "@/lib/search-params";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Setting up" };

const SETUP_PATH = `${DASHBOARD_PATH}/setup`;

export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const request = setupRequest(params);
  const session = await currentSession();
  if (!session) redirect(signInUrl(selfUrl(request, params), appDomain()));

  const dashboard = (
    <Button asChild variant="outline">
      <Link href={DASHBOARD_PATH}>Your accounts</Link>
    </Button>
  );

  if (request.kind === "request") {
    return (
      <State
        icon={<MailCheck />}
        title="Your request was sent"
        description="An owner of the organization has to approve the installation. Once they do, sign in again and the organization will be here."
      >
        {dashboard}
      </State>
    );
  }

  if (request.kind === "invalid") {
    return (
      <State
        icon={<Link2Off />}
        title="This link is missing its installation"
        description="GitHub sends you here after installing the App. Start the installation from GitHub, or go back to your accounts."
      >
        <Button asChild>
          <a href={INSTALL_APP_URL}>Install the GitHub App</a>
        </Button>
      </State>
    );
  }

  let result: SetupResult | undefined;
  const logger = createConsoleLogger();
  try {
    result = await withWriteDatabase((database) =>
      completeSetup({ database, github: githubApp(), logger }, request.installationId, session),
    );
  } catch (error) {
    logger.error("setup.failed", {
      installationId: request.installationId,
      githubUserId: session.githubId,
      error: errorMessage(error),
    });
  }

  if (result?.status === "member") redirect(organizationPath(result.slug));
  if (result?.status === "not_member") {
    logger.info("setup.not_member", {
      installationId: request.installationId,
      organization: result.slug,
      githubUserId: session.githubId,
      login: session.login,
    });
    return (
      <State
        icon={<UserX />}
        title={
          result.accountType === "user"
            ? `You are signed in as ${session.login}, not ${result.slug}`
            : `You are not a member of ${result.slug}`
        }
        description={
          result.accountType === "user"
            ? `The App is installed on the personal account ${result.slug}, but you are signed in as ${session.login}. Only ${result.slug} can open it. Sign out here, switch to ${result.slug} on GitHub, then sign back in.`
            : `The App is installed on ${result.slug}, but GitHub does not list ${session.login} as a member of it. To use another account, sign out here and switch accounts on GitHub before signing back in, or ask an owner of ${result.slug} to add you.`
        }
      >
        <div className="flex gap-2">
          <form action={signOutOfDashboard}>
            <SubmitButton pendingLabel="Signing out">Sign out</SubmitButton>
          </form>
          {dashboard}
        </div>
      </State>
    );
  }

  if (result?.status === "unsupported") {
    return (
      <State
        icon={<ShieldOff />}
        title="That account type is not supported"
        description="The dashboard serves organizations and personal accounts. Install the App on one of those instead."
      >
        {dashboard}
      </State>
    );
  }

  return (
    <State
      icon={<Clock />}
      title="Waiting for GitHub"
      description="The installation has not reached the dashboard yet. Reload in a moment, or check your accounts."
    >
      <div className="flex gap-2">
        <Button asChild>
          <a href={selfUrl(request, params)}>Reload</a>
        </Button>
        {dashboard}
      </div>
    </State>
  );
}

function State({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Setting up"
        description="Connecting the GitHub App installation to your account."
      />
      <EmptyState icon={icon} title={title} description={description} action={children} />
    </div>
  );
}

// Rebuilt from parsed values only, so nothing from the query is reflected as-is.
function selfUrl(request: ReturnType<typeof setupRequest>, params: Awaited<SearchParams>): string {
  const query = new URLSearchParams();
  if (request.kind === "sync") query.set("installation_id", String(request.installationId));
  if (request.kind === "request") query.set("setup_action", "request");
  else if (typeof params.setup_action === "string" && request.kind === "sync") {
    query.set("setup_action", params.setup_action === "update" ? "update" : "install");
  }
  const search = query.toString();
  return search ? `${SETUP_PATH}?${search}` : SETUP_PATH;
}
