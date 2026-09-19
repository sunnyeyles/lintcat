import { Button, EmptyState } from "@pr-review/design";
import { LogIn } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signInWithGithub } from "@/app/auth-actions";
import { PageHeader } from "@/components/shell";
import { safeCallbackUrl } from "@/lib/paths";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  if (await currentSession()) redirect(callbackUrl);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Sign in"
        description="Every review the action publishes for your organization, read from the dashboard's database."
      />
      <EmptyState
        icon={<LogIn />}
        title="Reviews your agents wrote"
        description="Sign in with GitHub to see your organizations' repositories, reviews and findings."
        action={
          <form action={signInWithGithub}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <Button type="submit">Sign in with GitHub</Button>
          </form>
        }
      />
    </div>
  );
}
