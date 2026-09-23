import * as React from "react"

type TextGenerateEffectProps = {
  words: string
  duration?: number
  stagger?: number
  className?: string
}

function TextGenerateEffect({ words, duration = 0.5, stagger = 0.2, className }: TextGenerateEffectProps) {
  return (
    <span data-slot="text-generate-effect" className={className}>
      {words.split(" ").map((word, idx) => (
        <span
          key={idx}
          className="animate-word-in inline-block whitespace-pre"
          style={
            {
              "--word-in-delay": `${idx * stagger}s`,
              "--word-in-duration": `${duration}s`,
            } as React.CSSProperties
          }
        >
          {idx > 0 ? ` ${word}` : word}
        </span>
      ))}
    </span>
  )
}

export { TextGenerateEffect }
