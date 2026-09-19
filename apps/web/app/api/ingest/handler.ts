import {
  findTeamByIngestToken,
  ingestReviewRecord,
  type Database,
  type IngestFailure,
  type Team,
} from "@pr-review/db";
import { reviewRecordSchema } from "@pr-review/schemas";

/** The route body, with the database passed in so tests need no `db()`. */
export async function handleIngest(
  request: Request,
  database: Database,
): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json(
      { error: "missing Authorization: Bearer <token>" },
      { status: 401 },
    );
  }

  const team = await findTeamByIngestToken(database, token);
  if (!team) {
    return Response.json({ error: "unknown ingest token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const parsed = reviewRecordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid review record", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await ingestReviewRecord(database, team.id, parsed.data);
  if (!result.ok) {
    return Response.json(
      { error: failureMessage(result.reason, team, parsed.data.owner) },
      { status: 404 },
    );
  }
  return Response.json({ reviewId: result.reviewId }, { status: 200 });
}

function bearerToken(header: string | null): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

function failureMessage(
  reason: IngestFailure,
  team: Team,
  owner: string,
): string {
  if (reason === "team-not-found") {
    return `team ${team.slug} no longer exists`;
  }
  const org = team.githubOrg ?? "(unset)";
  return `no team owns ${owner}: team ${team.slug} has github org ${org}`;
}
