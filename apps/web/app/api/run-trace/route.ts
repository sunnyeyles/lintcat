import { runTraceDeps } from "./deps";
import { handleRunTraceList } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleRunTraceList(request, runTraceDeps());
}
