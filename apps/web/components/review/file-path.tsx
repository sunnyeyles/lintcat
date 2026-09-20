import { cn } from "@pr-review/design";

export type FilePathProps = {
  file: string;
  line?: number | null;
  className?: string;
};

export function FilePath({ file, line, className }: FilePathProps) {
  const cut = file.lastIndexOf("/");
  const dir = cut === -1 ? "" : file.slice(0, cut);
  const base = cut === -1 ? file : file.slice(cut);
  const suffix = line == null ? "" : `:${line}`;
  const full = `${file}${suffix}`;

  return (
    <span
      title={full}
      className={cn("flex min-w-0 items-baseline font-mono whitespace-nowrap", className)}
    >
      <span className="sr-only">{full}</span>
      {dir ? (
        // RTL clips the head of the path, so the file name survives the squeeze.
        <span dir="rtl" aria-hidden className="min-w-0 truncate text-muted-foreground">
          {dir}
        </span>
      ) : null}
      <span aria-hidden className="shrink-0 text-foreground">
        {base}
        {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
      </span>
    </span>
  );
}
