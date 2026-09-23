import * as React from "react"
import { cn } from "#src/cn"

type MeteorsProps = {
  number?: number
  className?: string
}

// Deterministic spread so server and client render the same markup.
function Meteors({ number = 20, className }: MeteorsProps) {
  return (
    <div
      aria-hidden
      data-slot="meteors"
      className={cn("animate-spotlight-in pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {Array.from({ length: number }, (_, idx) => (
        <span
          key={idx}
          className="animate-meteor absolute -top-10 size-0.5 rounded-full bg-link shadow-[0_0_0_1px] shadow-link/10 before:absolute before:top-1/2 before:h-px before:w-12 before:-translate-y-1/2 before:bg-linear-to-r before:from-link before:to-transparent before:content-['']"
          style={
            {
              left: `${-20 + (idx * 120) / number}%`,
              "--meteor-delay": `${(idx * 7) % 5}s`,
              "--meteor-duration": `${5 + ((idx * 3) % 5)}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

export { Meteors }
