import { Avatar, AvatarFallback, AvatarImage, Button } from "@pr-review/design";

import { signInWithGithub, signOutOfDashboard } from "@/app/auth-actions";
import { currentSession } from "@/lib/session";

export async function UserMenu() {
  const session = await currentSession();
  if (!session) {
    return (
      <form action={signInWithGithub}>
        <Button type="submit" size="sm">
          Sign in
        </Button>
      </form>
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
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}
