// The pixel-art loop from docs/anidoodle; the poster stands in under reduced motion.
export function HowItWorksLoop() {
  return (
    <picture className="mb-6 block overflow-hidden rounded-lg border border-border">
      <source srcSet="/brand/how-it-works.png" media="(prefers-reduced-motion: reduce)" />
      <img
        src="/brand/how-it-works.gif"
        width={960}
        height={540}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
        alt="A pull request rides a belt past the LintCat mascot. The cat reads it and proposes findings; a gate labelled no model drops the weak ones; the rest land on the added lines as comments and the AI PR Review check lights up."
      />
    </picture>
  );
}
