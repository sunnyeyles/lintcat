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
import { Users } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RowLink } from "@/components/overview";
import { PageHeader } from "@/components/shell";
import { installAppUrl } from "@/lib/github-app";
import { appDomain } from "@/lib/host";
import { autoForwardPath, membershipsForUser } from "@/lib/organization";
import { DASHBOARD_PATH, organizationPath, signInUrl } from "@/lib/paths";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const session = await currentSession();
  if (!session) redirect(signInUrl(DASHBOARD_PATH, appDomain()));
  const memberships = await membershipsForUser(db(), session.githubId);
  const forward = autoForwardPath(memberships);
  if (forward) redirect(forward);
  const install = installAppUrl();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Your organizations"
        description="Every organization you belong to on the dashboard. Pick one to see its repositories and reviews."
      />
      {memberships.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>You are not in an organization yet</EmptyTitle>
            <EmptyDescription>
              <code>{session.login}</code> is signed in but belongs to no organization, so
              there is nothing to show.{" "}
              {install
                ? "Install the GitHub App on your organization, or ask an owner to add you."
                : "Ask an organization owner to add you."}
            </EmptyDescription>
          </EmptyHeader>
          {install ? (
            <EmptyContent>
              <Button asChild>
                <a href={install}>Install the GitHub App</a>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">
              Organizations you belong to, with your role in each.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Organization</TableHead>
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
                    </RowLink>
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
      )}
    </div>
  );
}
