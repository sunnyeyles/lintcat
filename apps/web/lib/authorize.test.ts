import {
  memberships,
  organizationSlugRedirects,
  organizations,
  repoAccess,
  repos,
  users,
  type Database,
  type MembershipRole,
  type Organization,
  type RepoPermission,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { authorize } from "@/lib/authorize";
import { renamedOrganizationUrl } from "@/lib/paths";

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

async function insertOrganization(
  githubAccountId: number,
  slug: string,
  suspendedAt: Date | null = null,
): Promise<Organization> {
  const [organization] = await database
    .insert(organizations)
    .values({
      githubAccountId,
      accountType: "organization",
      slug,
      name: slug,
      suspendedAt,
    })
    .returning();
  return organization!;
}

async function insertUser(githubId: number, login: string): Promise<number> {
  const [user] = await database
    .insert(users)
    .values({ githubId, login })
    .returning({ id: users.id });
  return user!.id;
}

async function join(
  userId: number,
  organization: Organization,
  role: MembershipRole,
): Promise<void> {
  await database
    .insert(memberships)
    .values({ userId, organizationId: organization.id, role });
}

const mona = { githubId: 1 };
const outsider = { githubId: 2 };

describe("authorize", () => {
  it("allows a member and returns the organization with their role", async () => {
    const acme = await insertOrganization(10, "acme");
    await join(await insertUser(1, "mona"), acme, "member");

    expect(await authorize(database, mona, "acme")).toEqual({
      status: "allowed",
      organization: acme,
      role: "member",
      readableRepos: [],
    });
  });

  it("gives a non-member and an unknown slug the identical not-found", async () => {
    const acme = await insertOrganization(10, "acme");
    await join(await insertUser(1, "mona"), acme, "owner");
    await insertUser(2, "outsider");

    const nonMember = await authorize(database, outsider, "acme");
    const unknownSlug = await authorize(database, mona, "no-such-org");

    expect(nonMember).toEqual({ status: "not-found" });
    expect(unknownSlug).toStrictEqual(nonMember);
  });

  it("gives a user who never signed in the same not-found", async () => {
    await insertOrganization(10, "acme");

    expect(await authorize(database, { githubId: 99 }, "acme")).toEqual({
      status: "not-found",
    });
  });

  it("returns each organization's own role for one user in two organizations", async () => {
    const acme = await insertOrganization(10, "acme");
    const globex = await insertOrganization(20, "globex");
    const user = await insertUser(1, "mona");
    await join(user, acme, "owner");
    await join(user, globex, "member");

    expect(await authorize(database, mona, "acme")).toEqual({
      status: "allowed",
      organization: acme,
      role: "owner",
      readableRepos: [],
    });
    expect(await authorize(database, mona, "globex")).toEqual({
      status: "allowed",
      organization: globex,
      role: "member",
      readableRepos: [],
    });
  });

  it("gives a member of a suspended organization the same not-found", async () => {
    const acme = await insertOrganization(10, "acme", new Date());
    await join(await insertUser(1, "mona"), acme, "owner");

    expect(await authorize(database, mona, "acme")).toEqual({ status: "not-found" });
  });

  describe("repositories", () => {
    let acme: Organization;
    let monaId: number;
    let widgets: number;
    let vault: number;
    let ledger: number;
    let gone: number;

    async function insertRepo(name: string, isPrivate: boolean): Promise<number> {
      const [repo] = await database
        .insert(repos)
        .values({ organizationId: acme.id, owner: "acme", name, private: isPrivate })
        .returning({ id: repos.id });
      return repo!.id;
    }

    async function grant(userId: number, repoId: number, permission: RepoPermission) {
      await database.insert(repoAccess).values({ userId, repoId, permission });
    }

    beforeEach(async () => {
      acme = await insertOrganization(10, "acme");
      monaId = await insertUser(1, "mona");
      await join(monaId, acme, "member");
      widgets = await insertRepo("widgets", false);
      vault = await insertRepo("vault", true);
      ledger = await insertRepo("ledger", true);
      gone = await insertRepo("gone", false);
      await database.update(repos).set({ removedAt: new Date() }).where(eq(repos.id, gone));
    });

    it("lets a member read public repos and the private ones they have access to, and no others", async () => {
      await grant(monaId, ledger, "read");

      expect(await authorize(database, mona, "acme")).toMatchObject({
        status: "allowed",
        readableRepos: [
          { id: widgets, isOwner: false },
          { id: ledger, isOwner: false },
        ],
      });
    });

    it("lets an organization owner read and own every live repo", async () => {
      await join(await insertUser(2, "octo"), acme, "owner");

      expect(await authorize(database, outsider, "acme")).toMatchObject({
        status: "allowed",
        readableRepos: [
          { id: widgets, isOwner: true },
          { id: vault, isOwner: true },
          { id: ledger, isOwner: true },
        ],
      });
    });

    it("makes a member with admin or maintain a repository owner of that repo only", async () => {
      await grant(monaId, ledger, "maintain");
      await grant(monaId, widgets, "admin");
      await grant(monaId, vault, "write");

      const access = await authorize(database, mona, "acme", { owner: "acme", name: "ledger" });
      expect(access).toMatchObject({
        status: "allowed",
        role: "member",
        repo: { id: ledger, name: "ledger", isOwner: true },
        readableRepos: [
          { id: widgets, isOwner: true },
          { id: vault, isOwner: false },
          { id: ledger, isOwner: true },
        ],
      });
    });

    it("gives an unreadable, removed or unknown repo the same not-found as an unknown organization", async () => {
      const unknownOrganization = await authorize(database, mona, "no-such-org");
      const unreadable = await authorize(database, mona, "acme", { owner: "acme", name: "vault" });
      const removed = await authorize(database, mona, "acme", { owner: "acme", name: "gone" });
      const unknown = await authorize(database, mona, "acme", { owner: "acme", name: "nope" });

      expect(unreadable).toEqual({ status: "not-found" });
      expect(unreadable).toStrictEqual(unknownOrganization);
      expect(removed).toStrictEqual(unknownOrganization);
      expect(unknown).toStrictEqual(unknownOrganization);
    });

    it("keeps one user's access rows from reading another organization's repos", async () => {
      const globex = await insertOrganization(20, "globex");
      await join(monaId, globex, "member");
      await grant(monaId, vault, "admin");

      expect(await authorize(database, mona, "globex")).toMatchObject({
        status: "allowed",
        readableRepos: [],
      });
    });
  });

  describe("a retired slug", () => {
    async function renamedAcme(): Promise<Organization> {
      const acme = await insertOrganization(10, "acme-corp");
      await database.insert(organizationSlugRedirects).values({ slug: "acme", organizationId: acme.id });
      await join(await insertUser(1, "mona"), acme, "member");
      await insertUser(2, "outsider");
      return acme;
    }

    it("redirects to the current slug, keeping the rest of the path", async () => {
      await renamedAcme();
      const access = await authorize(database, mona, "Acme", { owner: "acme", name: "api" });

      expect(access).toEqual({ status: "redirect", slug: "acme-corp" });
      if (access.status !== "redirect") return;
      expect(renamedOrganizationUrl("/o/acme/repos/acme/api?range=7d", access.slug, "prreview.dev")).toBe(
        "/o/acme-corp/repos/acme/api?range=7d",
      );
      expect(renamedOrganizationUrl("https://acme.prreview.dev/usage", access.slug, "prreview.dev")).toBe(
        "https://acme-corp.prreview.dev/usage",
      );
      expect(await authorize(database, mona, "acme-corp")).toMatchObject({ status: "allowed" });
    });

    it("redirects a non-member too, whose target is still not-found", async () => {
      await renamedAcme();

      expect(await authorize(database, outsider, "acme")).toEqual({
        status: "redirect",
        slug: "acme-corp",
      });
      expect(await authorize(database, outsider, "acme-corp")).toEqual({ status: "not-found" });
    });
  });

  it("matches the slug case-insensitively", async () => {
    const acme = await insertOrganization(10, "acme");
    await join(await insertUser(1, "mona"), acme, "member");

    expect(await authorize(database, mona, "Acme")).toMatchObject({
      status: "allowed",
    });
  });
});
