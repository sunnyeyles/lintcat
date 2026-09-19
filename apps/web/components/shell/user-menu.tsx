import { Button } from "@pr-review/design";

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
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}
