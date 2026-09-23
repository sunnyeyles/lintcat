import * as React from "react"
import { cn } from "#src/cn"

type SpotlightProps = {
  translateY?: number
  width?: number
  height?: number
  smallWidth?: number
  duration?: number
  xOffset?: number
  className?: string
}

// Stops scale with --spotlight-intensity, which theme.css raises on the dark canvas.
const beam = (centre: number, edge: number, at: string, fade: string) =>
  `radial-gradient(${at}, color-mix(in oklab, var(--spotlight) calc(var(--spotlight-intensity) * ${centre}%), transparent) 0, color-mix(in oklab, var(--spotlight) calc(var(--spotlight-intensity) * ${edge}%), transparent) ${fade}, transparent 100%)`

const FIRST = beam(8, 2, "68.54% 68.72% at 55.02% 31.46%", "50%")
const SECOND = beam(6, 2, "50% 50% at 50% 50%", "80%")
const THIRD = beam(4, 2, "50% 50% at 50% 50%", "80%")

function Beams({
  side,
  translateY,
  width,
  height,
  smallWidth,
}: Required<Pick<SpotlightProps, "translateY" | "width" | "height" | "smallWidth">> & {
  side: "left" | "right"
}) {
  const left = side === "left"
  const turn = left ? -45 : 45
  const anchor = left ? "left-0 origin-top-left" : "right-0 origin-top-right"
  return (
    <>
      <div
        className={cn("absolute top-0", left ? "left-0" : "right-0")}
        style={{
          transform: `translateY(${translateY}px) rotate(${turn}deg)`,
          background: FIRST,
          width,
          height,
        }}
      />
      <div
        className={cn("absolute top-0", anchor)}
        style={{
          transform: `rotate(${turn}deg) translate(${left ? 5 : -5}%, -50%)`,
          background: SECOND,
          width: smallWidth,
          height,
        }}
      />
      <div
        className={cn("absolute top-0", anchor)}
        style={{
          transform: `rotate(${turn}deg) translate(${left ? -180 : 180}%, -70%)`,
          background: THIRD,
          width: smallWidth,
          height,
        }}
      />
    </>
  )
}

function Spotlight({
  translateY = -350,
  width = 560,
  height = 1380,
  smallWidth = 240,
  duration = 7,
  xOffset = 100,
  className,
}: SpotlightProps) {
  const beams = { translateY, width, height, smallWidth }
  const drift = (to: number) =>
    ({
      "--spotlight-to": `${to}px`,
      "--spotlight-duration": `${duration / 2}s`,
    }) as React.CSSProperties

  return (
    <div
      aria-hidden
      data-slot="spotlight"
      className={cn(
        "animate-spotlight-in pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
    >
      <div className="animate-spotlight-drift absolute inset-0" style={drift(xOffset)}>
        <Beams side="left" {...beams} />
      </div>
      <div className="animate-spotlight-drift absolute inset-0" style={drift(-xOffset)}>
        <Beams side="right" {...beams} />
      </div>
    </div>
  )
}

export { Spotlight }
export type { SpotlightProps }
