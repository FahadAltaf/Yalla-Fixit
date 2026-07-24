"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CreditCard,
  Eye,
  FileText,
  ListCheck,
  ScrollText,
  Sparkles,
  User,
} from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrencyAED } from "@/utils/format-currency";

import type { AmcComputedData, AmcDocumentType, AmcFormData } from "../amc-types";
import { computeAmcData, formatDisplayDate } from "../amc-pricing";
import { AmcContractTemplate } from "../templates/AmcContractTemplate";
import { AmcProposalTemplate } from "../templates/AmcProposalTemplate";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  computed: AmcComputedData;
}

export function ReviewStep({ form, computed }: StepProps) {
  const values = form.watch();
  const [previewTab, setPreviewTab] = useState<AmcDocumentType>("proposal");

  const proposalPreview = useMemo(
    () => computeAmcData(values, "proposal"),
    [values],
  );
  const contractPreview = useMemo(
    () => computeAmcData(values, "contract"),
    [values],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              Property & Package
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Category:</span>{" "}
              <span className="capitalize">{values.propertyCategory}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Unit:</span>{" "}
              <span className="capitalize">{values.unitType}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Address:</span>{" "}
              {values.propertyAddress || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Detail:</span>{" "}
              {values.propertyDetail || "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="size-4 text-primary" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Name:</span>{" "}
              {values.customerName || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Proposal #:</span>{" "}
              {values.proposalNumber}
            </p>
            <p>
              <span className="text-muted-foreground">Period:</span>{" "}
              {formatDisplayDate(values.startDate)} →{" "}
              {formatDisplayDate(values.endDate)}
            </p>
            <p>
              <span className="text-muted-foreground">Payment:</span>{" "}
              <span className="capitalize">{values.paymentTerms}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="size-4 text-primary" />
            Cost Summary
          </CardTitle>
          <CardDescription>
            Service subtotal, discount, and final price with 5% VAT
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrencyAED(computed.totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Discount ({computed.totals.discountPercent}%)
            </span>
            <span>- {formatCurrencyAED(computed.totals.discountAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Final price (ex VAT)</span>
            <span>{formatCurrencyAED(computed.totals.finalPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (5%)</span>
            <span>{formatCurrencyAED(computed.totals.vatAmount)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-semibold">
            <span>Grand total</span>
            <span>{formatCurrencyAED(computed.totals.grandTotal)}</span>
          </div>
          <p className="pt-2 text-xs text-muted-foreground">
            {computed.totals.amountInWords}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ListCheck className="size-4 text-primary" />
            Selected Services (Clause 6.1)
          </CardTitle>
          <CardDescription>
            These rows will appear in the generated PDF
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {computed.frequencyRows.map((row) => (
                <TableRow key={row.scope}>
                  <TableCell className="text-xs">{row.scope}</TableCell>
                  <TableCell className="text-xs">{row.frequency}</TableCell>
                  <TableCell className="text-xs">{row.reference}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Document Preview
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Switch between proposal and contract previews before downloading.
            </p>
          </div>
          <Badge variant="outline" className="w-fit gap-1 text-xs">
            <Eye className="size-3" />
            Live preview
          </Badge>
        </div>

        <Tabs
          value={previewTab}
          onValueChange={(value) => setPreviewTab(value as AmcDocumentType)}
          className="w-full gap-3"
        >
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="proposal" className="gap-2">
              <FileText className="size-4" />
              Generate Proposal
            </TabsTrigger>
            <TabsTrigger value="contract" className="gap-2">
              <ScrollText className="size-4" />
              Generate Contract
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proposal" className="mt-0">
            <div className="border rounded-lg overflow-hidden bg-slate-100">
              <div className="bg-slate-100 overflow-auto flex items-start justify-center p-6 max-h-[600px]">
                <div className="shadow-2xl ring-1 ring-black/5 rounded overflow-hidden bg-white">
                  <AmcProposalTemplate data={proposalPreview} />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="contract" className="mt-0">
            <div className="border rounded-lg overflow-hidden bg-slate-100">
              <div className="bg-slate-100 overflow-auto flex items-start justify-center p-6 max-h-[600px]">
                <div className="shadow-2xl ring-1 ring-black/5 rounded overflow-hidden bg-white">
                  <AmcContractTemplate data={contractPreview} />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
