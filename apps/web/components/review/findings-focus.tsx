"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { FINDINGS_ANCHOR } from "./findings-section";

export type ReviewView = "findings" | "change" | "map";

interface FindingsFocus {
  file: string | null;
  view: ReviewView;
  showFile: (path: string) => void;
  clearFile: () => void;
  setView: (view: ReviewView) => void;
}

// Default no-op, so a findings table outside the provider keeps working unfiltered.
const Context = createContext<FindingsFocus>({
  file: null,
  view: "findings",
  showFile: () => {},
  clearFile: () => {},
  setView: () => {},
});

export function useFindingsFocus(): FindingsFocus {
  return useContext(Context);
}

export function FindingsFocusProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<string | null>(null);
  const [view, setView] = useState<ReviewView>("findings");

  const showFile = useCallback((path: string) => {
    // Flushed so the findings panel is visible before it is scrolled to.
    flushSync(() => {
      setFile(path);
      setView("findings");
    });
    document.getElementById(FINDINGS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, []);

  const clearFile = useCallback(() => setFile(null), []);
  const value = useMemo(
    () => ({ file, view, showFile, clearFile, setView }),
    [file, view, showFile, clearFile],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
