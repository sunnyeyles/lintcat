"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const FINDINGS_ANCHOR = "findings-heading";

interface FindingsFocus {
  file: string | null;
  showFile: (path: string) => void;
  clearFile: () => void;
}

// Default no-op, so a findings table outside the provider keeps working unfiltered.
const Context = createContext<FindingsFocus>({
  file: null,
  showFile: () => {},
  clearFile: () => {},
});

export function useFindingsFocus(): FindingsFocus {
  return useContext(Context);
}

export function FindingsFocusProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<string | null>(null);

  const showFile = useCallback((path: string) => {
    setFile(path);
    document.getElementById(FINDINGS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, []);

  const clearFile = useCallback(() => setFile(null), []);
  const value = useMemo(() => ({ file, showFile, clearFile }), [file, showFile, clearFile]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
