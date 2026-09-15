import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { Usage } from "@/lib/data/types";
import { formatNumber, formatTokens, formatUsd } from "@/lib/format";

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
      <CardHeader className="block">
        <CardTitle>Cost by repository</CardTitle>
        <CardDescription>
          Repository names are long and the list is open-ended, so this one stays a table.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="No repository spend"
            description={`Nothing was reviewed in ${rangePhrase}.`}
          />
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
                        <span
                          aria-hidden
                          className="h-1.5 w-12 shrink-0 rounded-[1px] bg-accent/15"
                        >
                          <span
                            className="block h-full rounded-[1px] bg-accent"
                            style={{ width: `${share}%` }}
                          />
                        </span>
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
