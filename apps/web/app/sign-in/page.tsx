import { Button, EmptyState } from "@pr-review/design";
import { LogIn, Users } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signInWithGithub } from "@/app/auth-actions";
import { PageHeader } from "@/components/shell";
import { currentMembership, currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  const session = await currentSession();
  if (session && (await currentMembership(session))) redirect("/");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title={session ? "No organization yet" : "Sign in"}
        description="Every review the action publishes for your organization, read from the dashboard's database."
      />
      {session ? (
        <EmptyState
          icon={<Users />}
          title="You are not in an organization yet"
          description={
            <>
              <code>{session.login}</code> is signed in but belongs to no organization, so
              there is nothing to show. Ask an organization owner to add you, then reload
              this page.
            </>
          }
        />
      ) : (
        <EmptyState
          icon={<LogIn />}
          title="Reviews your agents wrote"
          description="Sign in with GitHub to see your organization's repositories, reviews and findings."
          action={
            <form action={signInWithGithub}>
              <Button type="submit">Sign in with GitHub</Button>
            </form>
          }
        />
      )}
    </div>
  );
}
