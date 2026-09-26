import { getMapSource } from "@/lib/data/server";
import { parseReviewId } from "@/lib/review-id";

import { handleCodebaseMap } from "./handler";

// The Neon driver rules out the edge runtime.
export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string; reviewId: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { slug, reviewId } = await params;
  const id = parseReviewId(reviewId);
  if (id === null) {
    return Response.json({ error: "invalid review id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  return handleCodebaseMap(body, () => getMapSource(slug, id));
}
