import type { ReactNode } from "react";

export function MainColumn({ children }: { children: ReactNode }) {
  return (
    <main className="min-w-0 flex-1">
      <div className="mx-auto w-full max-w-[74rem] px-3 py-6 sm:px-6 sm:py-8">
        {children}
      </div>
    </main>
  );
}
