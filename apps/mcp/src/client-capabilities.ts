import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import type { SampleText } from "@pr-review/ai";

/** What the connected client can do, negotiated at initialize and fixed for the connection. */
export interface ClientFeatures {
  /** The client will answer `sampling/createMessage`. */
  readonly sampling: boolean;
  /** The client will answer `roots/list`. */
  readonly roots: boolean;
  /** The client notifies when its root list changes; false unless it also serves roots. */
  readonly rootsListChanged: boolean;
  /** The client accepts `notifications/message` log lines. */
  readonly logging: boolean;
}

/** The seam tools branch on; the raw capability record is read in one place, here. */
export interface ConnectedClient {
  features(): ClientFeatures;
  /** Filesystem paths of the workspace the client has open; empty when it serves no roots. */
  roots(): Promise<readonly string[]>;
  /** Runs one completion on the client's own model; only call it when features().sampling. */
  sample: SampleText;
}

/** Before initialize, and for a client that advertises nothing. */
export const NO_CLIENT_FEATURES: ClientFeatures = {
  sampling: false,
  roots: false,
  rootsListChanged: false,
  logging: false,
};

function advertises(capabilities: ClientCapabilities, name: string): boolean {
  return typeof (capabilities as Record<string, unknown>)[name] === "object";
}

/** Capability records are an open set, so presence of the key is the whole signal. */
export function readClientFeatures(capabilities: ClientCapabilities | undefined): ClientFeatures {
  if (capabilities === undefined) {
    return NO_CLIENT_FEATURES;
  }
  const roots = advertises(capabilities, "roots");
  return {
    sampling: advertises(capabilities, "sampling"),
    roots,
    rootsListChanged: roots && capabilities.roots?.listChanged === true,
    logging: advertises(capabilities, "logging"),
  };
}

/** The live adapter; reads on every call because nothing is negotiated until initialize. */
export function connectedClient(server: McpServer): ConnectedClient {
  const features = () => readClientFeatures(server.server.getClientCapabilities());
  const list = async () => (await server.server.listRoots()).roots.map(({ uri }) => fileURLToPath(uri));
  return {
    features,
    roots: async () => (features().roots ? list() : []),
    sample: async ({ systemPrompt, prompt, maxTokens, signal }) => {
      const result = await server.server.createMessage(
        {
          systemPrompt,
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          maxTokens,
        },
        signal === undefined ? {} : { signal },
      );
      if (result.content.type !== "text") {
        throw new Error(
          `the client answered sampling/createMessage with ${result.content.type} content, not text`,
        );
      }
      return result.content.text;
    },
  };
}

async function refuseSampling(): Promise<string> {
  throw new Error("this client does not answer sampling/createMessage");
}

/** The fake: a client stuck at whatever features you name, nothing else. */
export function staticClient(
  features: Partial<ClientFeatures> = {},
  roots: readonly string[] = [],
  sample: SampleText = refuseSampling,
): ConnectedClient {
  const fixed: ClientFeatures = { ...NO_CLIENT_FEATURES, roots: roots.length > 0, ...features };
  return { features: () => fixed, roots: async () => roots, sample };
}
