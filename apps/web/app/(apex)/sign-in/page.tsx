import { Card, EmptyState } from "@pr-review/design";
import { LogIn } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signInWithGithub } from "@/app/auth-actions";
import { PageHeader } from "@/components/shell";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInErrorMessage } from "@/lib/auth-errors";
import { appDomain } from "@/lib/host";
import { DASHBOARD_PATH, returnUrl, safeCallbackUrl } from "@/lib/paths";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const domain = appDomain();
  const params = await searchParams;
  const requested = safeCallbackUrl(params.callbackUrl, domain);
  const callbackUrl = returnUrl(requested === "/" ? DASHBOARD_PATH : requested, domain);
  if (await currentSession()) redirect(callbackUrl);
  const error = signInErrorMessage(params.error);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Sign in"
        description="Every review the action publishes for your organization, read from the dashboard's database."
      />
      {error ? (
        <Card role="alert" className="border-warn">
          <p className="font-mono text-label tracking-ui text-warn">{error}</p>
        </Card>
      ) : null}
      <EmptyState
        icon={<LogIn />}
        title="Reviews your agents wrote"
        description="Sign in with GitHub to see your organizations' repositories, reviews and findings."
        action={
          <form action={signInWithGithub}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <SubmitButton pendingLabel="Redirecting to GitHub">Sign in with GitHub</SubmitButton>
          </form>
        }
      />
    </div>
  );
}
