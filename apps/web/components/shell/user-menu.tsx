import { Avatar, AvatarFallback, AvatarImage, Button } from "@pr-review/design";
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
      <Avatar className="size-6">
        <AvatarImage src={session.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>{session.login.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="text-muted-foreground hidden font-mono text-sm sm:inline">
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
