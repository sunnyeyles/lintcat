import { defineConfig } from "drizzle-kit";

// Its own migrations, so factory tables never reach lintcat's hosted database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/store/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.FACTORY_DATABASE_URL ?? "" },
});
