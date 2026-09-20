import { Button } from "@pr-review/design";
import Link from "next/link";

import { signOutOfDashboard } from "@/app/auth-actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { currentSession } from "@/lib/session";

export async function UserMenu({ signInHref }: { signInHref?: string }) {
  const session = await currentSession();
  if (!session) {
    if (!signInHref) return null;
    return (
      <Button asChild size="sm">
        <Link href={signInHref}>Sign in</Link>
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {session.avatarUrl ? (
        <img
          src={session.avatarUrl}
          alt=""
          width={24}
          height={24}
          className="size-6 rounded-full border border-rule"
        />
      ) : null}
      <span className="hidden font-mono text-label text-slate sm:inline">
        {session.login}
      </span>
      <form action={signOutOfDashboard}>
        <SubmitButton variant="outline" size="sm" pendingLabel="Signing out">
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}
