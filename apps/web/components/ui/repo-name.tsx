export function RepoName({ owner, name, className }: { owner: string; name: string; className?: string }) {
  return (
    <span className={className}>
      <span className="text-muted-foreground">{owner}/</span>
      {name}
    </span>
  );
}
