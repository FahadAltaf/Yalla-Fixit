"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CalendarRange,
  ChevronDown,
  CreditCard,
  Download,
  FileText,
  FileType,
  ListCheck,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { PillTabs } from "@/components/dashboard/shared/kaizen";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AmcComputedData, AmcDocumentType, AmcFormData } from "../amc-types";
import { computeAmcData, formatDisplayDate } from "../amc-pricing";
import type { AmcSettings } from "../amc-settings";
import { AmcDocumentSheet } from "../templates/AmcDocumentSheet";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  computed: AmcComputedData;
  /** Saves the document in the preview as a PDF or Word file. */
  onDownload: (documentType: AmcDocumentType, format: "pdf" | "docx") => void;
  /** "proposal:pdf" and so on while a file is being built. */
  downloading: string | null;
  /**
   * FR6.2 — the AMC Settings text and values the documents are built from.
   * The same settings the download uses, so the preview shows exactly what
   * the PDF will say. Without them it fell back to the shipped defaults:
   * default clause wording and XXX contact numbers.
   */
  settings?: AmcSettings;
}

/** A titled part of the step, laid out like the other two steps. */
function ReviewSection({
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
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children || "—"}</dd>
    </div>
  );
}

export function ReviewStep({ form, computed, onDownload, downloading, settings }: StepProps) {
  const values = form.watch();
  const [previewTab, setPreviewTab] = useState<AmcDocumentType>("proposal");

  const proposalPreview = useMemo(
    () => computeAmcData(values, "proposal", settings),
    [values, settings],
  );
  const contractPreview = useMemo(
    () => computeAmcData(values, "contract", settings),
    [values, settings],
  );

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

      {/* The services and what they cost, side by side. */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ReviewSection
          icon={ListCheck}
          title="Selected services"
          description="Clause 6.1. These rows appear in the generated documents."
        >
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10">Scope</TableHead>
                  <TableHead className="h-10">Frequency</TableHead>
                  <TableHead className="h-10">Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computed.frequencyRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="text-muted-foreground py-6 text-center text-sm">
                      No services selected yet. Go back to Services and pricing to add some.
                    </TableCell>
                  </TableRow>
                ) : (
                  computed.frequencyRows.map((row) => (
                    <TableRow key={row.scope}>
                      <TableCell className="text-sm font-medium">{row.scope}</TableCell>
                      <TableCell className="text-sm">{row.frequency}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{row.reference}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </ReviewSection>

        <ReviewSection
          icon={CreditCard}
          title="Cost summary"
          description="Before and after 5% VAT."
        >
          <dl className="space-y-2.5 rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>
                <Money value={totals.subtotal} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Discount ({totals.discountPercent}%)</dt>
              <dd className="inline-flex items-center gap-1">
                − <Money value={totals.discountAmount} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Final price (excl. VAT)</dt>
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
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <dt className="font-semibold">Grand total</dt>
              <dd className="text-lg font-semibold">
                <Money value={totals.grandTotal} />
              </dd>
            </div>
            <p className="text-muted-foreground pt-1 text-xs leading-relaxed">
              {totals.amountInWords}
            </p>
          </dl>
        </ReviewSection>
      </div>

      {/* The two documents, exactly as they will be generated. */}
      <ReviewSection
        icon={Sparkles}
        title="Document preview"
        description="Switch between the proposal and the contract, download either one, then submit below."
      >
        {/*
          Named for what they are. These switch the preview; the buttons
          below the wizard are what actually generate, and having four
          controls reading "Generate Proposal" on one screen made the
          harmless pair look like the real ones. Download, at the end of
          the same row, saves whichever document is showing.
        */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs<AmcDocumentType>
            value={previewTab}
            onChange={setPreviewTab}
            tabs={[
              { value: "proposal", label: "Proposal" },
              { value: "contract", label: "Contract" },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={downloading !== null}>
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Download {previewTab}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDownload(previewTab, "pdf")}>
                <FileText className="size-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownload(previewTab, "docx")}>
                <FileType className="size-4" />
                Word (.docx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="bg-muted/50 overflow-hidden rounded-lg border">
          <div className="flex max-h-[600px] items-start justify-center overflow-auto p-6">
            <div className="overflow-hidden rounded bg-white shadow-lg ring-1 ring-black/5">
              <AmcDocumentSheet
                data={previewTab === "proposal" ? proposalPreview : contractPreview}
              />
            </div>
          </div>
        </div>
      </ReviewSection>
    </div>
  );
}
