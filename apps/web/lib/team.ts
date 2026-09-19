import { teams, users, type Database, type Team } from "@pr-review/db";
import { eq } from "drizzle-orm";

/** The user's team, or undefined while `users.teamId` is still null. */
export async function teamForUser(
  database: Database,
  githubId: number,
): Promise<Team | undefined> {
  const rows = await database
    .select({ team: teams })
    .from(users)
    .innerJoin(teams, eq(teams.id, users.teamId))
    .where(eq(users.githubId, githubId))
    .limit(1);
  return rows[0]?.team;
}
