import { runTraceDeps } from "../deps";
import { handleRunTraceIngest, handleRunTraceRead } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return handleRunTraceRead(request, (await params).runId, runTraceDeps());
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  return handleRunTraceIngest(request, (await params).runId, runTraceDeps());
}
