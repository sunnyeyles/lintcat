import { Button, EmptyState } from "@pr-review/design";
import { SearchX } from "lucide-react";
import Link from "next/link";

import { DocsTopbar } from "@/components/shell/docs-topbar";
import { MainColumn } from "@/components/shell/main-column";
import { DASHBOARD_PATH } from "@/lib/paths";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <DocsTopbar />
      <MainColumn>
        <EmptyState
          icon={<SearchX />}
          title="Page not found"
          description="There is nothing here, or you do not have access to it."
          action={
            <Button asChild variant="outline">
              <Link href={DASHBOARD_PATH}>Your accounts</Link>
            </Button>
          }
        />
      </MainColumn>
    </div>
  );
}
