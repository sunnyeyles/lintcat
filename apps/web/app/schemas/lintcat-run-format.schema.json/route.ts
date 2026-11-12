import { runEventJsonSchema } from "@pr-review/schemas";

export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(runEventJsonSchema(), { headers: { "cache-control": "public, max-age=3600" } });
}
