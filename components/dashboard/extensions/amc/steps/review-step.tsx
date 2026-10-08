"use client";

import { Building2, CalendarRange, ListCheck } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AmcComputedData, AmcFormData } from "../amc-types";
import { formatDisplayDate, formatPaymentLabel } from "../amc-pricing";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  computed: AmcComputedData;
}

/**
 * A titled part of the review, laid out like the sections of the other
 * two steps.
 */
export function ReviewSection({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: typeof Building2;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Icon className="text-brand size-4" />
            {title}
          </h3>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One label over its value, as a read-only field. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children || "—"}</dd>
    </div>
  );
}

/*
  How far the frequency column is indented, written once.

  Seven cells share it: the header, every service row, and each line of
  the sum underneath. They have to share it exactly, because the totals
  are read as a continuation of the column above them -- a label one
  notch out of line stops looking like the same column and starts looking
  like a mistake. Changing this moves all seven.
*/
const FREQUENCY_INDENT = "pl-16";

/**
 * The services and what they cost, in one card: the schedule
 * with each line's units, frequency and price, then the subtotal,
 * discount, VAT and total under it, and the total in words. One card
 * rather than two side by side, so the prices sit under the lines they
 * add up. Shared with the proposal's own page.
 */
export function ServicesAndCost({
  rows,
  totals,
}: {
  rows: AmcComputedData["frequencyRows"];
  totals: AmcComputedData["totals"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        {/*
          Four columns, measured.

          They were left to size themselves, so the service name took
          most of the table and Units, Frequency and Price were crowded
          into what was left at three different widths. The name still
          gets the room it needs for two lines. Units is narrow because a
          unit count is one or two digits; frequency and price take what
          their longest value needs.
        */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 w-[44%]">Service</TableHead>
              <TableHead className="h-10 w-[10%] text-right">Units</TableHead>
              <TableHead className={`h-10 w-[22%] ${FREQUENCY_INDENT}`}>
                Frequency
              </TableHead>
              <TableHead className="h-10 w-[24%] text-right">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-muted-foreground py-6 text-center text-sm">
                  No services selected.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.scope}>
                  <TableCell className="align-top text-sm">
                    <span className="font-medium">{row.scope}</span>
                    {row.reference ? (
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {row.reference}
                      </span>
                    ) : null}
                  </TableCell>
                  {/*
                    The three figures sit on the row's first line, not in
                    its middle: a service whose name wraps to two lines
                    pushed its units and price down to sit against nothing
                    while the name above them ran on.
                  */}
                  <TableCell className="align-top text-right text-sm tabular-nums">
                    {row.units}
                  </TableCell>
                  <TableCell
                    className={`text-muted-foreground align-top ${FREQUENCY_INDENT} text-sm whitespace-nowrap`}
                  >
                    {row.frequency}
                  </TableCell>
                  <TableCell className="align-top text-right text-sm font-medium whitespace-nowrap tabular-nums">
                    <Money value={Number(row.price) || 0} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>

          {/*
        The sum, under the column it sums.

        It ran the full width of the table, so on a wide screen "Subtotal"
        sat at the far left with its figure a foot away at the right, and
        the grand total looked like one more line of five. It is a block
        under the price column now: the figures stay beside their labels,
        and the total that matters is the one thing set apart.
      */}
          {/*
            The sum, in the table's own footer.

            It was a block under the table, sized to look as though it sat
            beneath the Price column. "Looks like" is the problem: the
            labels started at an arbitrary x of their own, so "Subtotal"
            and "2 per year" above it began in two different places and
            the footer read as a separate box pushed up against the
            table. In a tfoot the columns are the SAME columns, so every
            figure lines up with the figures above it by construction
            rather than by two widths being kept in step by hand.

            The words take the two columns the figures do not need.
          */}
          {/*
            No rules between the totals.

            TableRow carries a border-b, so in a tfoot every line of the
            sum drew a full-width rule and the five of them read as five
            more rows of data rather than as one block summing the rows
            above. The only rule that earns its place is the one over the
            grand total, which is the figure being set apart. The rows are
            tighter than data rows for the same reason: a sum is read down
            in one go, not scanned line by line.
          */}
          <TableFooter className="bg-muted/20 [&_tr]:border-0 [&_td]:py-1.5">
            <TableRow className="hover:bg-transparent">
              {/*
                Empty, and spanning, on purpose.

                The amount in words used to fill these two columns. It
                belongs on the contract -- it is there to settle a dispute
                about a figure, which is why cheques carry it -- and this
                is the team reading their own working before they submit
                it. Two lines of capitals for a number printed in full
                four rows up, under the one block on the page people
                actually check.

                The cell stays so the sum keeps its four columns: without
                it the totals slide left under Service and Units.
              */}
              <TableCell
                colSpan={2}
                rowSpan={totals.discountAmount > 0 ? 5 : 4}
                className="max-w-0"
              />
              <TableCell
                className={`text-muted-foreground pt-3 ${FREQUENCY_INDENT} text-sm font-normal`}
              >
                Subtotal
              </TableCell>
              <TableCell className="pt-3 text-right text-sm font-normal tabular-nums">
                <Money value={totals.subtotal} />
              </TableCell>
            </TableRow>

            {totals.discountAmount > 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  className={`text-muted-foreground ${FREQUENCY_INDENT} text-sm font-normal`}
                >
                  Discount ({totals.discountPercent}%)
                </TableCell>
                <TableCell className="text-success text-right text-sm font-normal tabular-nums">
                  − <Money value={totals.discountAmount} />
                </TableCell>
              </TableRow>
            ) : null}

            <TableRow className="hover:bg-transparent">
              <TableCell
                className={`text-muted-foreground ${FREQUENCY_INDENT} text-sm font-normal`}
              >
                Annual fee (excl. VAT)
              </TableCell>
              <TableCell className="text-right text-sm font-normal tabular-nums">
                <Money value={totals.finalPrice} />
              </TableCell>
            </TableRow>

            <TableRow className="hover:bg-transparent">
              <TableCell
                className={`text-muted-foreground ${FREQUENCY_INDENT} text-sm font-normal`}
              >
                VAT (5%)
              </TableCell>
              <TableCell className="text-right text-sm font-normal tabular-nums">
                <Money value={totals.vatAmount} />
              </TableCell>
            </TableRow>

            <TableRow className="hover:bg-transparent">
              <TableCell
                className={`mt-1 pt-2.5 pb-3 ${FREQUENCY_INDENT} text-sm font-semibold`}
              >
                Grand total
              </TableCell>
              <TableCell className="text-brand pt-2.5 pb-3 text-right text-lg font-semibold tabular-nums">
                <Money value={totals.grandTotal} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

/**
 * The last step: everything entered, read back, before it goes for
 * approval. The documents themselves open in a preview from the buttons
 * beside Submit, rather than sitting in a scroll box on the page.
 */
export function ReviewStep({ form, computed }: StepProps) {
  const values = form.watch();
  const { totals } = computed;

  return (
    <div className="space-y-8">
      {/* Everything entered in step 1, read back in one place. */}
      <ReviewSection
        icon={Building2}
        title="Property and client"
        description="Check these before submitting. Go back a step to change anything."
      >
        <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Client">{values.customerName}</Fact>
          <Fact label="Proposal number">{values.proposalNumber}</Fact>
          <Fact label="Property category">
            <span className="capitalize">{values.propertyCategory}</span>
          </Fact>
          <Fact label="Unit type">
            <span className="capitalize">{values.unitType}</span>
          </Fact>
          <Fact label="Address">{values.propertyAddress}</Fact>
          <Fact label="Property detail">{values.propertyDetail}</Fact>
          <Fact label="Contract period">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="text-muted-foreground size-3.5" aria-hidden />
              {formatDisplayDate(values.startDate)} → {formatDisplayDate(values.endDate)}
            </span>
          </Fact>
          <Fact label="Payment plan">{formatPaymentLabel(values)}</Fact>
        </dl>
      </ReviewSection>

      {/* The services, and what they add up to, in one card. */}
      <ReviewSection
        icon={ListCheck}
        title="Services and cost"
        description="As it appears in the documents, with the total before and after 5% VAT."
      >
        <ServicesAndCost rows={computed.frequencyRows} totals={totals} />
      </ReviewSection>
    </div>
  );
}
