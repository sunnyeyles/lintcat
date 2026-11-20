import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const repoPathSchema = z
  .string()
  .optional()
  .describe("Path to the git checkout; defaults to the server's working directory.");

export const orgSchema = z
  .string()
  .min(1)
  .describe('The account slug (a GitHub organization or personal account), as in the dashboard URL /o/<slug>.');

export const rangeSchema = z.enum(["7d", "30d", "90d"]).optional().describe("Time window; defaults to 30d.");

export function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
