import { db } from "@pr-review/db";
import {
  Badge,
  Button,
  Card,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import { FolderGit2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RowLink } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { INSTALL_APP_URL, installAppUrl } from "@/lib/github-app";
import { appDomain } from "@/lib/host";
import { autoForwardPath, membershipsForUser, ownsPersonalAccount } from "@/lib/organization";
import { DASHBOARD_PATH, organizationPath, signInUrl } from "@/lib/paths";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Accounts" };

export default async function OrganizationsPage() {
  const session = await currentSession();
  if (!session) redirect(signInUrl(DASHBOARD_PATH, appDomain()));
  const memberships = await membershipsForUser(db(), session.githubId);
  const forward = autoForwardPath(memberships);
  if (forward) redirect(forward);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Your accounts"
        description="Your personal account and the organizations you belong to. Pick one to see its repositories and reviews."
      />
      {memberships.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderGit2 />
            </EmptyMedia>
            <EmptyTitle>Connect your repositories</EmptyTitle>
            <EmptyDescription>
              You are signed in as <code>{session.login}</code>. Install the GitHub App on your
              personal account to review your own repositories. You do not need an organization. An
              organization&apos;s repositories need the App installed on that organization by one of
              its owners.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            <Button asChild>
              <a href={installAppUrl(session.githubId)}>Install on @{session.login}</a>
            </Button>
            <Button asChild variant="outline">
              <a href={INSTALL_APP_URL}>Install on an organization</a>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Card className="py-0">
            <Table>
              <TableCaption className="sr-only">
                Accounts you belong to, with your role in each.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Account</TableHead>
                  <TableHead scope="col">Address</TableHead>
                  <TableHead scope="col" className="text-right">
                    Role
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map(({ organization, role }) => (
                  <TableRow key={organization.id} className="group relative">
                    <TableCell>
                      <RowLink href={organizationPath(organization.slug)}>
                        {organization.name}
                      </RowLink>{" "}
                      <Badge variant="outline">
                        {organization.accountType === "user" ? "Personal" : "Organization"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">
                      {organizationPath(organization.slug)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{role}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {!ownsPersonalAccount(memberships, session.githubId) && (
            <p className="text-muted-foreground text-sm">
              Want to review your own repositories too?{" "}
              <a className="text-link underline" href={installAppUrl(session.githubId)}>
                Add your personal account
              </a>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
