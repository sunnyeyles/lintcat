import { users, type Database, type User } from "@pr-review/db";

/** The GitHub profile fields mirrored into `users`; `id` is the GitHub user id. */
export type GithubUserProfile = {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

/** Upserts by `githubId`, leaving `teamId` and `role` as the team set them. */
export async function upsertGithubUser(
  database: Database,
  profile: GithubUserProfile,
): Promise<User> {
  const fields = {
    login: profile.login,
    name: profile.name ?? null,
    email: profile.email ?? null,
    avatarUrl: profile.avatar_url ?? null,
  };
  const rows = await database
    .insert(users)
    .values({ githubId: profile.id, ...fields })
    .onConflictDoUpdate({ target: users.githubId, set: fields })
    .returning();
  const row = rows[0];
  if (!row) throw new Error(`could not upsert github user ${profile.login}`);
  return row;
}
