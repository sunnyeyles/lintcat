import { z } from "zod";

import type { CheckRunAnnotation } from "#src/client";

/**
 * The slice of Octokit this package consumes. Octokit satisfies it
 * structurally; tests inject a stub so no real network calls happen.
 */
export interface OctokitLike {
  rest: {
    pulls: {
      get(params: {
        owner: string;
        repo: string;
        pull_number: number;
        mediaType?: { format: "diff" };
      }): Promise<{ data: unknown }>;
      listFiles(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      listReviewComments(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      listCommits(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      createReview(params: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        body: string;
        event: "COMMENT";
        comments: {
          path: string;
          line: number;
          side: "RIGHT";
          start_line?: number;
          start_side?: "RIGHT";
          body: string;
        }[];
      }): Promise<{ data: unknown }>;
    };
    repos: {
      get(params: { owner: string; repo: string }): Promise<{ data: unknown }>;
      getContent(params: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      downloadTarballArchive(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      listCommits(params: {
        owner: string;
        repo: string;
        path: string;
        per_page: number;
      }): Promise<{ data: unknown }>;
      getCommit(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      compareCommits(params: {
        owner: string;
        repo: string;
        base: string;
        head: string;
      }): Promise<{ data: unknown }>;
      createOrUpdateFileContents(params: {
        owner: string;
        repo: string;
        path: string;
        message: string;
        content: string;
        branch: string;
        sha?: string;
      }): Promise<{ data: unknown }>;
    };
    git: {
      getRef(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      createRef(params: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
      }): Promise<{ data: unknown }>;
      createTree(params: {
        owner: string;
        repo: string;
        base_tree: string;
        tree: {
          path: string;
          mode: "100644";
          type: "blob";
          content: string;
        }[];
      }): Promise<{ data: unknown }>;
      createCommit(params: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }): Promise<{ data: unknown }>;
      updateRef(params: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
        force: boolean;
      }): Promise<{ data: unknown }>;
    };
    search: {
      code(params: {
        q: string;
        per_page: number;
        mediaType: { format: string };
      }): Promise<{ data: unknown }>;
    };
    checks: {
      listForRef(params: {
        owner: string;
        repo: string;
        ref: string;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      create(params: {
        owner: string;
        repo: string;
        name: string;
        head_sha: string;
        status: "completed";
        conclusion: "success" | "failure" | "neutral";
        output: {
          title: string;
          summary: string;
          text?: string;
          annotations?: CheckRunAnnotation[];
        };
      }): Promise<{ data: unknown }>;
    };
  };
  graphql(query: string, variables: Record<string, unknown>): Promise<unknown>;
}

export const PAGE_SIZE = 100;

export const changedFilesSchema = z.array(
  z.object({
    filename: z.string(),
    status: z.string(),
    previous_filename: z.string().optional(),
    additions: z.number(),
    deletions: z.number(),
    patch: z.string().optional(),
  }),
);

/** The head SHA of a ref; a missing ref is a 404, not an empty response. */
export const refSchema = z.object({ object: z.object({ sha: z.string() }) });

/** Walks numbered pages until a short one; GitHub sends no other end marker. */
export async function paginate<T>(
  fetchPage: (page: number) => Promise<{ data: unknown }>,
  parsePage: (data: unknown) => T[],
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const pageItems = parsePage((await fetchPage(page)).data);
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE) {
      return items;
    }
  }
}
