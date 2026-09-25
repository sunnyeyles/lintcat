import {
  Alert,
  AlertDescription,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pr-review/design";
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
  const callbackUrl = returnUrl(
    requested === "/" ? DASHBOARD_PATH : requested,
    domain,
  );
  if (await currentSession()) redirect(callbackUrl);
  const error = signInErrorMessage(params.error);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Sign in"
        description="Every review LintCat publishes for your repositories, read from the dashboard's database."
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LogIn />
          </EmptyMedia>
          <EmptyTitle>Reviews your agents wrote</EmptyTitle>
          <EmptyDescription>
            Sign in with GitHub to see your repositories, reviews and
            findings.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <form action={signInWithGithub}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <SubmitButton pendingLabel="Redirecting to GitHub">Sign in with GitHub</SubmitButton>
          </form>
        </EmptyContent>
      </Empty>
    </div>
  );
}
