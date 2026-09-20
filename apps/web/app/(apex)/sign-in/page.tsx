import {
  Button,
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
  const requested = safeCallbackUrl((await searchParams).callbackUrl, domain);
  const callbackUrl = returnUrl(
    requested === "/" ? DASHBOARD_PATH : requested,
    domain,
  );
  if (await currentSession()) redirect(callbackUrl);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Sign in"
        description="Every review the action publishes for your organization, read from the dashboard's database."
      />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LogIn />
          </EmptyMedia>
          <EmptyTitle>Reviews your agents wrote</EmptyTitle>
          <EmptyDescription>
            Sign in with GitHub to see your organizations' repositories, reviews and
            findings.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <form action={signInWithGithub}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <Button type="submit">Sign in with GitHub</Button>
          </form>
        </EmptyContent>
      </Empty>
    </div>
  );
}
