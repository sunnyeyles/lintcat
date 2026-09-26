import { cn } from "#src/cn"

// `as="span"` for a skeleton inside phrasing content, such as a <p>.
function Skeleton({
  className,
  as: Comp = "div",
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: "div" | "span" }) {
  return (
    <Comp
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-accent",
        Comp === "span" && "inline-block align-middle",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
