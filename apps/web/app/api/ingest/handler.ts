import {
  findOrganizationByIngestToken,
  ingestReviewRecord,
  type Database,
  type IngestFailure,
  type Organization,
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

  const organization = await findOrganizationByIngestToken(database, token);
  if (!organization) {
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

  const result = await ingestReviewRecord(
    database,
    organization.id,
    parsed.data,
  );
  if (!result.ok) {
    return Response.json(
      { error: failureMessage(result.reason, organization, parsed.data.owner) },
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
  organization: Organization,
  owner: string,
): string {
  if (reason === "organization-not-found") {
    return `organization ${organization.slug} no longer exists`;
  }
  if (reason === "repo-removed") {
    return `organization ${organization.slug} no longer tracks that repository`;
  }
  return `organization ${organization.slug} does not own ${owner}`;
}
