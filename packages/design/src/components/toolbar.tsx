import * as React from "react"
import { cn } from "#src/cn"

function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2",
        className
      )}
      {...props}
    />
  )
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

export { Toolbar, ToolbarGroup }
