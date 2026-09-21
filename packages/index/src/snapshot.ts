/**
 * The index, serialised for storage: a projection of what is already built,
 * never a second computation, so a new field on IndexedFile flows through.
 */
import { gunzipSync, gzipSync } from "node:zlib";

import type { IndexedFile, RepositoryIndex } from "#src/build";
import type { ImportedName } from "#src/imports";
import type { WorkspacePackage } from "#src/workspace";

/** One resolved import; unresolved ones point at nothing worth storing. */
export interface SnapshotEdge {
  readonly from: string;
  readonly to: string;
  readonly names: readonly ImportedName[];
}

/** One repository graph at one commit, as JSON. */
export interface RepositoryGraphSnapshot {
  readonly sha: string;
  readonly truncated: boolean;
  readonly files: readonly IndexedFile[];
  readonly edges: readonly SnapshotEdge[];
  readonly packages: readonly WorkspacePackage[];
}

/** Serialises the index. Files keep their insertion order, which is sorted by path. */
export function snapshotRepositoryIndex(
  index: RepositoryIndex,
): RepositoryGraphSnapshot {
  return {
    sha: index.sha,
    truncated: index.truncated,
    files: [...index.files.values()].map((file) => ({ ...file })),
    edges: index.edges.flatMap((edge) =>
      edge.to === undefined
        ? []
        : [{ from: edge.from, to: edge.to, names: edge.names }],
    ),
    packages: index.packages.map((workspacePackage) => ({
      ...workspacePackage,
    })),
  };
}

/** Gzipped JSON: the only form the snapshot is ever sent or stored in. */
export function encodeRepositoryGraph(
  snapshot: RepositoryGraphSnapshot,
): Uint8Array {
  return gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"));
}

export function decodeRepositoryGraph(
  encoded: Uint8Array,
): RepositoryGraphSnapshot {
  return JSON.parse(
    gunzipSync(encoded).toString("utf8"),
  ) as RepositoryGraphSnapshot;
}
