"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import type { ReactNode } from "react";

export type ChartDataRow = { key: string; cells: ReactNode[] };

export type ChartDataTableProps = {
  caption: string;
  columns: readonly string[];
  rows: readonly ChartDataRow[];
};

// The text alternative every chart carries: no value is reachable only by hovering.
export function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  return (
    <details className="mt-3 border-t pt-2">
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer text-xs tracking-wide uppercase outline-none focus-visible:ring-2">
        {caption}
      </summary>
      <div className="mt-2">
        <Table className="min-w-[20rem]">
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead
                  key={column}
                  className={index === 0 ? "" : "text-right"}
                  scope="col"
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                {row.cells.map((cell, index) => (
                  <TableCell
                    key={`${row.key}-${columns[index] ?? index}`}
                    className={index === 0 ? "" : "text-right tabular-nums"}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
