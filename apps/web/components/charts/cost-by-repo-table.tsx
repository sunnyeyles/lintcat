import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";

import { RepoName } from "@/components/ui";
import { formatNumber, formatPercent, formatTokens, formatUsd, share } from "@/lib/format";
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
                const part = share(row.costUsd, total);
                return (
                  <TableRow key={row.repo.id}>
                    <TableCell className="whitespace-nowrap">
                      <RepoName owner={row.repo.owner} name={row.repo.name} />
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
                        <span className="tabular-nums">{formatPercent(part, 1)}</span>
                        <Progress value={part} className="h-1.5 w-12 shrink-0" />
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
