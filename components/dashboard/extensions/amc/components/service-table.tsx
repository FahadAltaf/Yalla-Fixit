"use client";

import type { UseFormReturn } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
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

import { isFrequencyEditable } from "../amc-constants";
import { calculateAmcTotals, computeServiceRowPrice } from "../amc-pricing";
import { servicesForProperty, type AmcServiceDefinition } from "../amc-settings";
import type { AmcFormData } from "../amc-types";

interface ServiceTableProps {
  form: UseFormReturn<AmcFormData>;
  /** The services AMC Settings defines (the catalogue for this proposal). */
  catalogue: ReadonlyArray<AmcServiceDefinition>;
  /**
   * A rate card is in force (BRD 5.3): base prices are the card's, shown
   * read-only, with promotions and below-floor lines marked. Without one
   * they are entered per proposal, as before.
   */
  rateCard?: boolean;
  /** Shown under the discount: the approval its size needs. */
  discountNote?: React.ReactNode;
}

export function ServiceTable({ form, catalogue, rateCard = false, discountNote }: ServiceTableProps) {
  const unitType = form.watch("unitType");
  const serviceRows = form.watch("serviceRows");
  const discountPercent = form.watch("discountPercent") ?? 0;
  const formValues = form.watch();
  const totals = calculateAmcTotals(formValues);
  const availableServices = servicesForProperty({ services: [...catalogue] }, unitType);
  const enabledCount = catalogue.filter((service) => service.enabled !== false).length;

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
                    <TableHead className="w-[100px]">Units</TableHead>
                    <TableHead className="w-[120px]">Frequency</TableHead>
                    <TableHead className="w-[70px] text-left">Free</TableHead>
                    <TableHead className="w-[120px]">{rateCard ? "Rate" : "Base price"}</TableHead>
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
                          {/*
                            Unlimited and covered are not numbers, so they
                            are not offered as one.

                            An emergency call-out is unlimited by
                            definition, and the table showed it as a
                            greyed-out box reading 1 -- which says the
                            client gets one of them, and reads as a field
                            somebody forgot to switch on. The word that
                            will print on the contract is shown instead.
                          */}
                          {frequencyEditable ? (
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              className="h-8 text-xs"
                              placeholder="e.g. 2"
                              disabled={!row.included}
                              aria-label={`Frequency for ${service.label}`}
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
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {service.frequencyType === "unlimited"
                                ? "Unlimited"
                                : "Covered"}
                            </span>
                          )}
                        </TableCell>

                        {/*
                          Free, and so not priced. Thrown in on one
                          contract and charged on the next, which is why
                          it is a tick here rather than a fact about the
                          service.
                        */}
                        {/*
                          pr-2 put back deliberately.

                          TableCell ships `[&:has([role=checkbox])]:pr-0`,
                          which is right for a selection column flush
                          against the table edge and wrong here: with the
                          right padding gone the cell centres its checkbox
                          over a box 8px wider on that side, so the tick
                          sat 4px right of the Free heading above it
                          (measured). Restoring the padding puts both
                          centres on the same x.
                        */}
                        <TableCell className="text-center [&:has([role=checkbox])]:pr-2">
                          <Checkbox
                            checked={row.free === true}
                            disabled={!row.included}
                            onCheckedChange={(checked) =>
                              updateRow(service.id, {
                                free: checked === true,
                                /*
                                  The price goes with the tick. Left
                                  behind under Included it comes back the
                                  moment the tick does, and nobody
                                  expects a figure they cannot see.
                                */
                                ...(checked === true
                                  ? { basePrice: undefined }
                                  : {}),
                              })
                            }
                            aria-label={`Include ${service.label} free of charge`}
                          />
                        </TableCell>
                        <TableCell>
                          {/*
                            FR2.4/FR2.12: entered per proposal, required on
                            every checked row, and 0 is legitimate (a service
                            given free). Empty string when unset so the field
                            reads as blank rather than as a free service, and
                            an erased value goes back to undefined rather than
                            collapsing to 0.
                          */}
                          {row.free ? (
                            <span className="text-muted-foreground text-xs">
                              Included
                            </span>
                          ) : rateCard ? (
                            /* From the rate card: read-only (BRD 5.3). */
                            <div className="grid gap-0.5 text-xs">
                              {row.basePrice === undefined ? (
                                <span className={row.included ? "text-destructive" : "text-muted-foreground"}>No rate on the card</span>
                              ) : (
                                <span className="tabular-nums">{formatCurrencyAED(row.basePrice)}</span>
                              )}
                              {row.promotionPercent ? (
                                <Badge variant="secondary" className="bg-success/10 text-success w-fit border-0 px-1.5 py-0 text-[10px] font-medium">
                                  Promotion −{row.promotionPercent}%
                                </Badge>
                              ) : null}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 text-xs"
                              placeholder="0.00"
                              disabled={!row.included}
                              aria-label={`Base price for ${service.label}`}
                              value={row.basePrice ?? ""}
                              onChange={(event) =>
                                updateRow(service.id, {
                                  basePrice:
                                    event.target.value === ""
                                      ? undefined
                                      : Math.max(0, Number(event.target.value)),
                                })
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums">
                          {row.included && !row.free && row.basePrice === undefined ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatCurrencyAED(price)
                          )}
                          {row.included && row.belowFloor ? (
                            <div className="text-warning text-[10px] font-normal" title={row.floorRate != null ? `Floor rate ${formatCurrencyAED(row.floorRate)}` : undefined}>
                              Below floor after discount
                            </div>
                          ) : null}
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
        {discountNote}

        <Separator />

        <div className="flex justify-between text-sm font-semibold">
          <span>Final price</span>
          <span>{formatCurrencyAED(totals.finalPrice)}</span>
        </div>
      </div>

      {availableServices.length !== enabledCount && (
        <p className="text-xs text-muted-foreground">
          Services that AMC Settings doesn&apos;t offer on this kind of property are hidden.
        </p>
      )}
    </div>
  );
}
