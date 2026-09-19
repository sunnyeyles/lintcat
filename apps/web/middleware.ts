import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_PATH_HEADER } from "@/lib/paths";

// Server components cannot read the URL, so the sign-in redirect gets it from here.
export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/o/:path*" };
