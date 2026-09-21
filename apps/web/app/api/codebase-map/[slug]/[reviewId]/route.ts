import { getMapSource } from "@/lib/data/server";

import { handleCodebaseMap } from "./handler";

// The Neon driver rules out the edge runtime.
export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string; reviewId: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { slug, reviewId } = await params;
  const id = Number(reviewId);
  if (!Number.isInteger(id) || id <= 0 || id > 2 ** 31 - 1) {
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
