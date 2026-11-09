"use client";

import { useCallback, useSyncExternalStore } from "react";

export type LiveRunSummary = { runId: string; title: string | null; startedAt: string; lastSeenAt: string };
export type LiveRunFiles = { run: LiveRunSummary; files: { name: string; text: string }[] };

const TOKEN_KEY = "run-trace-token";
export const POLL_MS = 3000;
// The hook pushes at least every few seconds while a run works, so a minute of silence means it ended.
const LIVE_WINDOW_MS = 60_000;

const listeners = new Set<() => void>();

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The ingest token, kept in this browser only. */
export function useRunTraceToken(): [string | null, (token: string | null) => void] {
  const token = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readToken,
    () => null,
  );
  const set = useCallback((next: string | null) => {
    try {
      if (next) localStorage.setItem(TOKEN_KEY, next);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
    for (const listener of listeners) listener();
  }, []);
  return [token, set];
}

export function isLive(run: LiveRunSummary, now = Date.now()): boolean {
  return now - Date.parse(run.lastSeenAt) < LIVE_WINDOW_MS;
}

// The API answers 404 to a bad token, so a 404 on the list means the token is wrong.
export async function fetchRunTrace<T>(path: string, token: string): Promise<T | undefined> {
  const response = await fetch(path, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as T;
}
