"use client";

import type { UseFormReturn } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

import {
  AMC_SERVICES,
  getServicesForUnitType,
  isFrequencyEditable,
} from "../amc-constants";
import { calculateAmcTotals, computeServiceRowPrice } from "../amc-pricing";
import type { AmcFormData } from "../amc-types";

interface ServiceTableProps {
  form: UseFormReturn<AmcFormData>;
}

export function ServiceTable({ form }: ServiceTableProps) {
  const unitType = form.watch("unitType");
  const serviceRows = form.watch("serviceRows");
  const discountPercent = form.watch("discountPercent") ?? 0;
  const formValues = form.watch();
  const totals = calculateAmcTotals(formValues);
  const availableServices = getServicesForUnitType(unitType);

  const updateRow = (
    serviceId: string,
    patch: Partial<(typeof serviceRows)[number]>,
  ) => {
    const nextRows = serviceRows.map((row) =>
      row.serviceId === serviceId ? { ...row, ...patch } : row,
    );
    form.setValue("serviceRows", nextRows, { shouldValidate: true });
  };

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="serviceRows"
        render={() => (
          <FormItem>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Service</TableHead>
                    <TableHead className="w-[100px]">No. of Units</TableHead>
                    <TableHead className="w-[100px]">Frequency</TableHead>
                    <TableHead className="w-[120px] text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableServices.map((service) => {
                    const rowIndex = serviceRows.findIndex(
                      (row) => row.serviceId === service.id,
                    );
                    const row = serviceRows[rowIndex];
                    if (!row) return null;

                    const price = computeServiceRowPrice(row);
                    const frequencyEditable = isFrequencyEditable(
                      service.frequencyType,
                    );

                    return (
                      <TableRow key={service.id}>
                        <TableCell>
                          <Checkbox
                            checked={row.included}
                            onCheckedChange={(checked) =>
                              updateRow(service.id, {
                                included: checked === true,
                              })
                            }
                            aria-label={`Include ${service.label}`}
                          />
                        </TableCell>
                        <TableCell className="text-xs">{service.label}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="h-8 text-xs"
                            placeholder="1"
                            disabled={!row.included}
                            value={row.units}
                            onChange={(event) =>
                              updateRow(service.id, {
                                units: Math.max(
                                  1,
                                  Number.parseInt(event.target.value, 10) || 1,
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="h-8 text-xs"
                            placeholder="e.g. 2"
                            disabled={!row.included || !frequencyEditable}
                            value={row.frequency}
                            onChange={(event) =>
                              updateRow(service.id, {
                                frequency: Math.max(
                                  1,
                                  Number.parseInt(event.target.value, 10) || 1,
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          {formatCurrencyAED(price)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-medium">{formatCurrencyAED(totals.subtotal)}</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <FormField
            control={form.control}
            name="discountPercent"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="text-sm">Discount (%)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    className="h-8 max-w-[140px]"
                    placeholder="0"
                    value={field.value ?? 0}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value
                          ? Number(event.target.value)
                          : 0,
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="text-sm text-right pt-6">
            <span className="text-muted-foreground">
              {discountPercent}% →{" "}
            </span>
            <span className="font-medium">
              {formatCurrencyAED(totals.discountAmount)}
            </span>
          </div>
        </div>

        <Separator />

        <div className="flex justify-between text-sm font-semibold">
          <span>Final Price</span>
          <span>{formatCurrencyAED(totals.finalPrice)}</span>
        </div>
      </div>

      {availableServices.length !== AMC_SERVICES.length && (
        <p className="text-xs text-muted-foreground">
          Villa-only services are hidden for non-villa unit types.
        </p>
      )}
    </div>
  );
}
