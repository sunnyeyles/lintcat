import { headers } from "next/headers";

import { REQUEST_PATH_HEADER } from "@/lib/paths";

export type RequestLocation = { host: string | null; protocol: string; path: string | null };

/** Host, scheme and served path of the current request, as the proxy reports them. */
export async function requestLocation(): Promise<RequestLocation> {
  const requestHeaders = await headers();
  return {
    host: requestHeaders.get("host"),
    protocol: requestHeaders.get("x-forwarded-proto") ?? "http",
    path: requestHeaders.get(REQUEST_PATH_HEADER),
  };
}
