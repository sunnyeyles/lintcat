import type { ReactNode } from "react";

export const metadata = { robots: { index: false, follow: false } };

export default function DevLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
