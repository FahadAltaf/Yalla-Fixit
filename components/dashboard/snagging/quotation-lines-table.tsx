"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The priced lines of a quotation, with its totals.
 *
 * Lines and totals are one block, the way an invoice reads: keeping the
 * totals in the table footer rather than in a panel floating beside it
 * means every figure lands in the Amount column. The numeric columns are
 * pinned to a fixed width so a single short line item cannot fling them
 * to the far edge of a wide card and leave a dead gap across the middle.
 *
 * Presentational only, so the same markup can be rendered against a
 * fixture without going near the API.
 */

export type QuotationLine = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
};

export function QuotationLinesTable({
  lines,
  currency,
  subtotal,
  taxRate,
  taxAmount,
  total,
}: {
  lines: QuotationLine[];
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}) {
  const money = (value: number) =>
    `${currency} ${Number(value).toLocaleString("en-AE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10">Description</TableHead>
            <TableHead className="h-10 w-24 text-right">Qty</TableHead>
            <TableHead className="h-10 w-28 text-right">Rate</TableHead>
            <TableHead className="h-10 w-32 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {lines.map((line, index) => (
            <TableRow key={index} className="hover:bg-transparent ">
              <TableCell className="font-medium">{line.description}</TableCell>
              <TableCell className="text-muted-foreground text-right whitespace-nowrap tabular-nums">
                {line.qty} {line.unit}
              </TableCell>
              <TableCell className="text-muted-foreground text-right whitespace-nowrap tabular-nums">
                {money(line.unit_price)}
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                {money(line.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>

        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2} className="hidden sm:table-cell" />
            <TableCell className="text-muted-foreground text-right font-normal">Subtotal</TableCell>
            <TableCell className="text-right whitespace-nowrap tabular-nums">
              {money(subtotal)}
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2} className="hidden sm:table-cell" />
            <TableCell className="text-muted-foreground text-right font-normal">
              VAT ({taxRate}%)
            </TableCell>
            <TableCell className="text-right whitespace-nowrap tabular-nums">
              {money(taxAmount)}
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2} className="hidden sm:table-cell" />
            <TableCell className="text-right">Total</TableCell>
            <TableCell className="text-right text-base font-semibold whitespace-nowrap tabular-nums">
              {money(total)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
