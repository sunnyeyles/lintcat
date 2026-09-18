import type { ComponentProps } from "react";

import { cn } from "#src/cn";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn(
          "w-full min-w-[28rem] border-collapse font-mono text-body",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-rule-soft transition-colors last:border-b-0 hover:bg-surface-2/60",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-rule pr-3 pb-2 text-left text-caption font-medium tracking-caps text-slate uppercase last:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "py-2.5 pr-3 align-top text-slate last:pr-0 [&:first-child]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      className={cn("caption-bottom pt-3 text-caption text-slate", className)}
      {...props}
    />
  );
}
