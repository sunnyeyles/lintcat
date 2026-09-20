import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Progress,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";

import { formatNumber, formatTokens, formatUsd } from "@/lib/format";
import type { Usage } from "@pr-review/db/dashboard";

import { sumTokens } from "./series";

export function CostByRepoTable({
  byRepo,
  rangePhrase,
}: {
  byRepo: Usage["byRepo"];
  rangePhrase: string;
}) {
  const rows = byRepo.filter((row) => row.reviewCount > 0);
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle>Cost by repository</CardTitle>
        <CardDescription>
          Repository names are long and the list is open-ended, so this one stays a table.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No repository spend</EmptyTitle>
              <EmptyDescription>Nothing was reviewed in {rangePhrase}.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableCaption>
              {formatUsd(total)} across {formatNumber(rows.length)} repositories in{" "}
              {rangePhrase}.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Repository</TableHead>
                <TableHead scope="col" className="text-right">
                  Reviews
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Tokens
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Cost
                </TableHead>
                <TableHead scope="col" className="w-[7rem] text-right">
                  Share
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const share = total === 0 ? 0 : (row.costUsd / total) * 100;
                return (
                  <TableRow key={row.repo.id}>
                    <TableCell className="whitespace-nowrap">
                      {row.repo.owner}/{row.repo.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.reviewCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(sumTokens(row))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(row.costUsd)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end gap-2">
                        <span className="tabular-nums">{share.toFixed(1)}%</span>
                        <Progress value={share} className="h-1.5 w-12 shrink-0" />
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
