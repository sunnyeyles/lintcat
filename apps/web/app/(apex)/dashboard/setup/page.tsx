import { withWriteDatabase } from "@pr-review/db";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pr-review/design";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";
import { Clock, Link2Off, MailCheck, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell";
import { githubApp, installAppUrl } from "@/lib/github-app";
import { appDomain } from "@/lib/host";
import { completeSetup, setupRequest, type SetupResult } from "@/lib/installation";
import { DASHBOARD_PATH, organizationPath, signInUrl } from "@/lib/paths";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Setting up" };

const SETUP_PATH = `${DASHBOARD_PATH}/setup`;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SetupPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const request = setupRequest(params);
  const session = await currentSession();
  if (!session) redirect(signInUrl(selfUrl(request, params), appDomain()));

  const dashboard = (
    <Button asChild variant="outline">
      <Link href={DASHBOARD_PATH}>Your organizations</Link>
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
    const install = installAppUrl();
    return (
      <State
        icon={<Link2Off />}
        title="This link is missing its installation"
        description="GitHub sends you here after installing the App. Start the installation from GitHub, or go back to your organizations."
      >
        {install ? (
          <Button asChild>
            <a href={install}>Install the GitHub App</a>
          </Button>
        ) : (
          dashboard
        )}
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
  if (result?.status === "not_member") redirect(DASHBOARD_PATH);

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
      description="The installation has not reached the dashboard yet. Reload in a moment, or check your organizations."
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
        description="Connecting the GitHub App installation to your organization."
      />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{children}</EmptyContent>
      </Empty>
    </div>
  );
}

// Rebuilt from parsed values only, so nothing from the query is reflected as-is.
function selfUrl(
  request: ReturnType<typeof setupRequest>,
  params: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  if (request.kind === "sync") query.set("installation_id", String(request.installationId));
  if (request.kind === "request") query.set("setup_action", "request");
  else if (typeof params.setup_action === "string" && request.kind === "sync") {
    query.set("setup_action", params.setup_action === "update" ? "update" : "install");
  }
  const search = query.toString();
  return search ? `${SETUP_PATH}?${search}` : SETUP_PATH;
}
