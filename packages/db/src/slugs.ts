import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import { organizationSlugRedirects, organizations, type Organization } from "./schema";

export interface OrganizationRename {
  organization: Organization;
  from: string;
  to: string;
}

// The claimant wins: a redirect on `slug` is dropped, and a live holder was renamed unseen
// (logins are unique), so it moves aside to `<slug>_<account id>`.
export async function claimSlug(
  database: Database,
  slug: string,
  accountId: number,
): Promise<void> {
  await database
    .delete(organizationSlugRedirects)
    .where(eq(organizationSlugRedirects.slug, slug));
  await database
    .update(organizations)
    .set({ slug: sql`${organizations.slug} || '_' || ${organizations.githubAccountId}` })
    .where(and(eq(organizations.slug, slug), ne(organizations.githubAccountId, accountId)));
}

/** Moves a known account to its new login's slug and keeps the old one as a redirect. */
export async function renameOrganization(
  database: Database,
  accountId: number,
  login: string,
): Promise<OrganizationRename | undefined> {
  const [existing] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.githubAccountId, accountId))
    .limit(1);
  const slug = login.toLowerCase();
  if (!existing || (existing.slug === slug && existing.name === login)) return undefined;
  if (existing.slug !== slug) {
    await claimSlug(database, slug, accountId);
    await database
      .insert(organizationSlugRedirects)
      .values({ slug: existing.slug, organizationId: existing.id })
      .onConflictDoUpdate({
        target: organizationSlugRedirects.slug,
        set: { organizationId: existing.id },
      });
  }
  const [organization] = await database
    .update(organizations)
    .set({ slug, name: login })
    .where(eq(organizations.id, existing.id))
    .returning();
  if (!organization) throw new Error("organization rename returned no row");
  return { organization, from: existing.slug, to: slug };
}

/** The current slug a retired one points at. */
export async function findSlugRedirect(
  database: Database,
  slug: string,
): Promise<string | undefined> {
  const [row] = await database
    .select({ slug: organizations.slug })
    .from(organizationSlugRedirects)
    .innerJoin(organizations, eq(organizations.id, organizationSlugRedirects.organizationId))
    .where(eq(organizationSlugRedirects.slug, slug.toLowerCase()))
    .limit(1);
  return row?.slug;
}
