"use client";

import { Building2, CreditCard, Eye, ListCheck, Sparkles, User } from "lucide-react";
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
import { formatDisplayDate } from "../amc-pricing";
import { AmcContractTemplate } from "../templates/AmcContractTemplate";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  computed: AmcComputedData;
}

export function ReviewStep({ form, computed }: StepProps) {
  const values = form.getValues();
  const selectedPackage = AMC_PACKAGES.find((pkg) => pkg.id === values.packageId);
  const includedServices = values.serviceRows
    .filter((row) => row.included)
    .map((row) => AMC_SERVICES.find((service) => service.id === row.serviceId)?.label)
    .filter(Boolean);

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
              Preview the generated AMC proposal before downloading.
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
