"use client";

import { Building2, CalendarRange, ListCheck } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AmcComputedData, AmcFormData } from "../amc-types";
import { formatDisplayDate } from "../amc-pricing";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  computed: AmcComputedData;
}

/**
 * A titled part of the review, laid out like the other two steps. Shared
 * with the proposal's own page, so a proposal reads the same before and
 * after it is submitted.
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
      <div className="flex flex-wrap items-end justify-between gap-2">
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
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10">Service</TableHead>
              <TableHead className="h-10 text-right">Units</TableHead>
              <TableHead className="h-10">Frequency</TableHead>
              <TableHead className="h-10 text-right">Price</TableHead>
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
                  <TableCell className="text-sm">
                    <span className="font-medium">{row.scope}</span>
                    {row.reference ? (
                      <span className="text-muted-foreground block text-xs">{row.reference}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{row.units}</TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {row.frequency}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    <Money value={Number(row.price) || 0} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <dl className="bg-muted/20 space-y-2 border-t px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd>
            <Money value={totals.subtotal} />
          </dd>
        </div>
        {totals.discountAmount > 0 ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Discount ({totals.discountPercent}%)</dt>
            <dd className="inline-flex items-center gap-1">
              − <Money value={totals.discountAmount} />
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Annual fee (excl. VAT)</dt>
          <dd>
            <Money value={totals.finalPrice} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">VAT (5%)</dt>
          <dd>
            <Money value={totals.vatAmount} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-2.5">
          <dt className="font-semibold">Grand total</dt>
          <dd className="text-lg font-semibold">
            <Money value={totals.grandTotal} />
          </dd>
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">{totals.amountInWords}</p>
      </dl>
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
        title="Property and customer"
        description="Check these before submitting. Go back a step to change anything."
      >
        <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Customer">{values.customerName}</Fact>
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
          <Fact label="Payment terms">
            <span className="capitalize">{values.paymentTerms}</span>
          </Fact>
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
