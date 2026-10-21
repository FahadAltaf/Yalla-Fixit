"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
import {
  BASE_PRICE_MESSAGE,
  CUSTOM_SERVICE_PREFIX,
  isCustomServiceRow,
  type AmcFormData,
  type AmcService,
} from "../amc-types";
import { CustomServiceDialog, type CustomServiceDraft } from "./custom-service-dialog";

/* "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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
  /*
    What the table lists: the standard services for this kind of property,
    then any added to this proposal alone (DEV-260), which are a number of
    visits a year like a PPM service.
  */
  const listed: (Pick<AmcService, "id" | "label" | "frequencyType"> & { custom: boolean })[] = [
    ...availableServices.map((service) => ({ ...service, custom: false })),
    ...serviceRows.filter(isCustomServiceRow).map((row) => ({
      id: row.serviceId,
      label: row.customName?.trim() || "Custom service",
      frequencyType: "fixed" as const,
      custom: true,
    })),
  ];
  // null: closed. "new": adding one. Otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const editingRow =
    editing && editing !== "new" ? serviceRows.find((row) => row.serviceId === editing) : undefined;
  // Ticked, not free, and no price yet: what the base price error is about.
  const unpriced = listed
    .filter((service) => {
      const row = serviceRows.find((r) => r.serviceId === service.id);
      return Boolean(row?.included && !row.free && row.basePrice === undefined);
    })
    .map((service) => service.label);
  const flagUnpriced = form.formState.errors.serviceRows?.message === BASE_PRICE_MESSAGE;

  const updateRow = (
    serviceId: string,
    patch: Partial<(typeof serviceRows)[number]>,
  ) => {
    const nextRows = serviceRows.map((row) =>
      row.serviceId === serviceId ? { ...row, ...patch } : row,
    );
    form.setValue("serviceRows", nextRows, { shouldValidate: true });
  };

  const saveCustom = (draft: CustomServiceDraft) => {
    if (editing && editing !== "new") {
      updateRow(editing, draft);
      return;
    }
    form.setValue(
      "serviceRows",
      [
        ...serviceRows,
        {
          serviceId: `${CUSTOM_SERVICE_PREFIX}${crypto.randomUUID()}`,
          included: true,
          units: 1,
          frequency: 1,
          free: false,
          basePrice: undefined,
          equipment: "",
          ...draft,
        },
      ],
      { shouldValidate: true },
    );
  };

  const removeCustom = (serviceId: string) => {
    form.setValue(
      "serviceRows",
      serviceRows.filter((row) => row.serviceId !== serviceId),
      { shouldValidate: true },
    );
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
                    <TableHead className="w-[120px]">Base price</TableHead>
                    <TableHead className="w-[120px] text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listed.map((service) => {
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
                        <TableCell className="text-xs">
                          {service.custom ? (
                            <div className="flex items-center gap-1.5">
                              <span>{service.label}</span>
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                                Custom
                              </Badge>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`Edit ${service.label}`}
                                onClick={() => setEditing(service.id)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive size-6"
                                aria-label={`Remove ${service.label}`}
                                onClick={() => removeCustom(service.id)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="block">{service.label}</span>
                          )}
                          {/*
                            DEV-261: what the service covers here, as the
                            signed contracts name it. Only on a ticked row,
                            since only those print.
                          */}
                          {row.included ? (
                            <Input
                              className="mt-2 block h-8 w-full max-w-[240px] text-xs md:text-xs"
                              placeholder="Equipment, e.g. 10 FCU"
                              maxLength={80}
                              aria-label={`Equipment for ${service.label}`}
                              value={row.equipment ?? ""}
                              onChange={(event) =>
                                updateRow(service.id, { equipment: event.target.value })
                              }
                            />
                          ) : null}
                        </TableCell>
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
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 text-xs"
                              placeholder="0.00"
                              disabled={!row.included}
                              aria-label={`Base price for ${service.label}`}
                              aria-invalid={
                                flagUnpriced && row.included && row.basePrice === undefined
                                  ? true
                                  : undefined
                              }
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
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                Add custom service
              </Button>
            </div>
            {/*
              Names the services still waiting for a price (AMC-057). The
              bare "every selected service" sent people hunting, and a
              free service with no price confused the team until Free
              was ticked.
            */}
            {form.formState.errors.serviceRows?.message === BASE_PRICE_MESSAGE &&
            unpriced.length > 0 ? (
              <p className="text-destructive text-sm">
                Enter a base price for {listNames(unpriced)}, or tick Free if{" "}
                {unpriced.length === 1 ? "it is" : "they are"} included at no charge.
              </p>
            ) : (
              <FormMessage />
            )}
          </FormItem>
        )}
      />

      <CustomServiceDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        initial={
          editingRow
            ? { customName: editingRow.customName ?? "", customScope: editingRow.customScope ?? "" }
            : null
        }
        onSave={saveCustom}
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
          <span>Final price</span>
          <span>{formatCurrencyAED(totals.finalPrice)}</span>
        </div>
      </div>

      {availableServices.length !== AMC_SERVICES.length && (
        <p className="text-xs text-muted-foreground">
          Villa-only services are hidden for apartments and offices.
        </p>
      )}
    </div>
  );
}
