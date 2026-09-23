import { Button, Spotlight } from "@pr-review/design";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { MapPreview } from "@/components/landing/map-preview";
import { LogoMark } from "@/components/shell/logo-mark";
import { DOCS_HOME } from "@/lib/docs";
import { INSTALL_APP_URL } from "@/lib/github-app";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="bg-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
      />
      <Spotlight className="-z-10" />
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-20 pb-16 text-center sm:px-8 md:pt-28">
        <LogoMark animate="always" className="size-12" />
        <p className="eyebrow mt-6">Code review for people and agents</p>
        <h1 className="mt-4 max-w-3xl bg-linear-to-b from-foreground to-muted-foreground bg-clip-text pb-2 font-display text-4xl font-bold tracking-display text-transparent md:text-6xl">
          Know what every change touches.
        </h1>
        <p className="mt-4 max-w-2xl text-lede text-muted-foreground">
          LintCat indexes your repository and reviews each pull request against it. Your
          coding agent gets the same insight over MCP, before anything is pushed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <a href={INSTALL_APP_URL}>
              Install the GitHub App
              <ArrowRight />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={DOCS_HOME}>Read the docs</Link>
          </Button>
        </div>
        <MapPreview className="mt-16 w-full max-w-4xl text-left" />
      </div>
    </section>
  );
}
