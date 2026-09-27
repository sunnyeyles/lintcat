# 3. Repository collaborators get a derived role, not a stored one

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** sunny

(There are two ADRs numbered 0002; this is the next number after them.)

## Decision

A user who has no membership in an account, but holds a `repo_access` row on
at least one live repo of it, is a **collaborator** there. `authorize` works
this out when it reads the rows, and nothing stores it: `AccessRole` is
`MembershipRole | "collaborator"` in TypeScript, and the Postgres
`membership_role` enum is unchanged.

- A collaborator reads **exactly** the repos they have rows for. Unlike a
  member, they don't see the account's other public repos, because the
  dashboard also shows the account's usage and spend.
- `admin` or `maintain` on a repo still makes them that repo's owner. Account
  settings stay owner-only.
- This covers collaborators on someone else's personal repo, and outside
  collaborators on an organization repo.

## Why not a stored `collaborator` membership

- It would duplicate `repo_access` and would have to be kept in step on every
  path that writes that table: sign-in, the `member` webhook, `privatized`,
  repo removal and transfer, and `installation_repositories.removed`.
- `replaceMembers` rebuilds memberships from GitHub's member list on install
  and unsuspend, so it would wipe stored collaborators each time.
- A stored row left behind would still open an account the user can no longer
  read. With the derived role, access ends when the last row goes.
- "Member" keeps meaning a GitHub organization member.

## How access is discovered

- **At sign-in:** the Auth.js account token is a GitHub App user access
  token, because `AUTH_GITHUB_ID` is the App's client id. The dashboard calls
  `GET /user/installations`, then `GET /user/installations/{id}/repositories`
  for each live installation where the user has no membership. That is 1 + K
  calls, where K is the number of accounts the user collaborates in; it
  doesn't grow with the number of installed accounts. The token is used during
  the sign-in pass and never stored.
- **By webhook:** `member` events now route through the repository owner when
  the payload carries no organization. The repo permission is looked up
  whatever the membership, using installation tokens.

## Consequences

- `repo_access` rows for non-members, written earlier by `privatized` events,
  now grant access. This matches what GitHub already lets those users read.
- If GitHub doesn't deliver `member` events for personal accounts, a removed
  collaborator keeps access until their next sign-in. If that happens, the
  follow-up is a periodic sweep that re-checks collaborator rows.
- A revoked membership now deletes repo rows only when a membership was
  actually removed. Otherwise sign-in would wipe collaborator grants on every
  account the user isn't a member of.
