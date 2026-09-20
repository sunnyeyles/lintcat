import { NextResponse, type NextRequest } from "next/server";

import { appDomain, organizationSlugFromHost, subdomainRewritePath } from "@/lib/host";
import { apexUrl, isApexOnly, REQUEST_PATH_HEADER } from "@/lib/paths";

// Server components cannot read the URL, so the sign-in redirect gets it from here.
export function middleware(request: NextRequest): NextResponse {
  const { pathname, search, protocol } = request.nextUrl;
  const host = request.headers.get("host");
  const slug = organizationSlugFromHost(host, appDomain());
  const headers = new Headers(request.headers);

  if (slug === undefined) {
    headers.set(REQUEST_PATH_HEADER, pathname + search);
    return NextResponse.next({ request: { headers } });
  }

  if (isApexOnly(pathname)) {
    const apex = apexUrl(pathname + search, host, protocol.replace(/:$/, ""), appDomain());
    return NextResponse.redirect(new URL(apex));
  }

  headers.set(REQUEST_PATH_HEADER, `${protocol}//${host}${pathname}${search}`);
  const url = request.nextUrl.clone();
  url.pathname = subdomainRewritePath(slug, pathname);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = { matcher: "/((?!api/|_next/|favicon.ico).*)" };
