import { db } from "@pr-review/db";

import { handleIngest } from "./handler";

// node:crypto and the Neon driver rule out the edge runtime.
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleIngest(request, db());
}
