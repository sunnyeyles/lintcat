import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const repoPathSchema = z
  .string()
  .optional()
  .describe("Path to the git checkout; defaults to the server's working directory.");

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function jsonContent(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: jsonText(value) };
}

export function json(value: unknown): CallToolResult {
  return { content: [jsonContent(value)] };
}
