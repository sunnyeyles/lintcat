import { Button, EmptyState } from "@pr-review/design";
import { SearchX } from "lucide-react";
import Link from "next/link";

import { MainColumn } from "@/components/shell/main-column";

export default function NotFound() {
  return (
    <MainColumn>
      <EmptyState
        icon={<SearchX />}
        title="Page not found"
        description="There is nothing here, or you do not have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Your organizations</Link>
          </Button>
        }
      />
    </MainColumn>
  );
}
