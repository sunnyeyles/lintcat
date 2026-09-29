import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pr-review/design";
import Link from "next/link";

export type EmptyNoticeProps = {
  title: string;
  sentence: string;
  action: { label: string; href: string };
};

// External hrefs (GitHub) get a plain anchor; in-app ones a client-side Link.
export function EmptyNotice({ title, sentence, action }: EmptyNoticeProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{sentence}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          {action.href.startsWith("/") ? (
            <Link href={action.href}>{action.label}</Link>
          ) : (
            <a href={action.href}>{action.label}</a>
          )}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
