import { db } from "@pr-review/db";
import {
  Card,
  Chip,
  EmptyState,
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
import { membershipsForUser } from "@/lib/organization";
import { appDomain } from "@/lib/host";
import { organizationPath, signInUrl } from "@/lib/paths";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const session = await currentSession();
  if (!session) redirect(signInUrl("/", appDomain()));
  const memberships = await membershipsForUser(db(), session.githubId);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Your organizations"
        description="Every organization you belong to on the dashboard. Pick one to see its repositories and reviews."
      />
      {memberships.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="You are not in an organization yet"
          description={
            <>
              <code>{session.login}</code> is signed in but belongs to no organization, so
              there is nothing to show. Ask an organization owner to add you, then reload
              this page.
            </>
          }
        />
      ) : (
        <Card padding="table">
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
                  <TableCell className="font-mono text-slate">
                    {organizationPath(organization.slug)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Chip variant="soft">{role}</Chip>
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
