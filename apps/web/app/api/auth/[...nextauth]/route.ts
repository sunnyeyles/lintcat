import { handlers } from "@/auth";

// The sign-in callback writes to Postgres through the Neon driver.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
