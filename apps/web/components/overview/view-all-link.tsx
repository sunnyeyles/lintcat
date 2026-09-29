import Link from "next/link";

export function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="text-link font-mono text-xs no-underline hover:underline"
    >
      View all →
    </Link>
  );
}
