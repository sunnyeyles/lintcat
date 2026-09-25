import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const repoPathSchema = z
  .string()
  .optional()
  .describe("Path to the git checkout; defaults to the server's working directory.");

export function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
