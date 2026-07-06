"use client";

import { Eye, Sparkles } from "lucide-react";
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
import { formatCurrencyAED } from "@/utils/format-currency";

import { AMC_PACKAGES, AMC_SERVICES } from "../amc-constants";
import type { AmcComputedData, AmcFormData } from "../amc-types";
import { AmcContractTemplate } from "../templates/AmcContractTemplate";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  computed: AmcComputedData;
}

export function ReviewStep({ form, computed }: StepProps) {
  const values = form.getValues();
  const selectedPackage = AMC_PACKAGES.find((pkg) => pkg.id === values.packageId);
  const selectedServiceLabels = values.selectedServices
    .map((id) => AMC_SERVICES.find((service) => service.id === id)?.label)
    .filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Property & Package</CardTitle>
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
            <Separator className="my-2" />
            <p>
              <span className="text-muted-foreground">Package:</span>{" "}
              {values.propertyCategory === "commercial"
                ? "Commercial (custom rate)"
                : selectedPackage?.name ?? "—"}
            </p>
            {selectedServiceLabels.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {selectedServiceLabels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Customer</CardTitle>
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
              {values.startDate} → {computed.endDate}
            </p>
            <p>
              <span className="text-muted-foreground">Payment:</span>{" "}
              <span className="capitalize">{values.paymentTerms}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cost Summary</CardTitle>
          <CardDescription>Annual contract value with 5% VAT</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Monthly rate</span>
            <span>{formatCurrencyAED(computed.totals.monthlyPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Annual subtotal (ex VAT)</span>
            <span>{formatCurrencyAED(computed.totals.annualSubtotal)}</span>
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Selected Services (Clause 6.1)</CardTitle>
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
              Contract Preview
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Preview the generated AMC contract before downloading.
            </p>
          </div>
          <Badge variant="outline" className="w-fit gap-1 text-xs">
            <Eye className="size-3" />
            Live preview
          </Badge>
        </div>

        <div className="border rounded-lg overflow-hidden bg-slate-100">
          <div className="bg-slate-100 overflow-auto flex items-start justify-center p-6 max-h-[600px]">
            <div className="shadow-2xl ring-1 ring-black/5 rounded overflow-hidden bg-white">
              <AmcContractTemplate data={computed} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
