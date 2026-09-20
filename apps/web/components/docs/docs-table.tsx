import {
  Card,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import type { ReactNode } from "react";

export type DocsTableProps = {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
};

export function DocsTable({ caption, columns, rows }: DocsTableProps) {
  return (
    <Card padding="table">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column} scope="col">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((cells, row) => (
            <TableRow key={row}>
              {cells.map((cell, column) => (
                <TableCell
                  key={column}
                  className={column === 0 ? "font-mono text-ink" : "text-slate"}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
