import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pr-review/design";
import { SearchX } from "lucide-react";
import Link from "next/link";

import { MainColumn } from "@/components/shell/main-column";
import { DASHBOARD_PATH } from "@/lib/paths";

export default function NotFound() {
  return (
    <MainColumn>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>
            There is nothing here, or you do not have access to it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline" size="sm">
            <Link href={DASHBOARD_PATH}>Your organizations</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </MainColumn>
  );
}
