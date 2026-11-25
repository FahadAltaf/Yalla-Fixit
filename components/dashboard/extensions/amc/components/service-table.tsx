"use client";

import { Fragment, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { SquarePen, Plus, RotateCcw, Trash2, Wrench, MessageSquareText } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrencyAED } from "@/utils/format-currency";

import { isFrequencyEditable } from "../amc-constants";
import { calculateAmcTotals, computeServiceRowPrice } from "../amc-pricing";
import { servicesForProperty, type AmcServiceDefinition } from "../amc-settings";
import {
  BASE_PRICE_MESSAGE,
  CUSTOM_SERVICE_PREFIX,
  isCustomServiceRow,
  type AmcFormData,
  type AmcService,
} from "../amc-types";
import { CustomServiceDialog, type CustomServiceDraft } from "./custom-service-dialog";
import { ServiceScopeButton } from "./service-scope-button";

/* What the frequency counts, where it is not visits a year (Scope of Works Library). */
const FREQUENCY_UNIT: Partial<Record<AmcService["frequencyType"], string>> = {
  handyman: "hours a year",
  weekly: "visits a week",
  manpower: "days a week",
};

/* "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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
  /**
   * The visits a year the rate card allows for a service (BRD 5.3); empty
   * when it does not limit them. The frequency is then picked from these.
   */
  allowedFrequencies?: (serviceId: string) => readonly number[];
}

export function ServiceTable({ form, catalogue, rateCard = false, discountNote, allowedFrequencies }: ServiceTableProps) {
  const unitType = form.watch("unitType");
  const serviceRows = form.watch("serviceRows");
  const discountPercent = form.watch("discountPercent") ?? 0;
  const formValues = form.watch();
  const totals = calculateAmcTotals(formValues);
  const propertyType = form.watch("propertyType");
  const propertyRecordId = form.watch("propertyRecordId") ?? null;
  const availableServices = servicesForProperty({ services: [...catalogue] }, [propertyType, unitType]);
  const enabledCount = catalogue.filter((service) => service.enabled !== false).length;
  /*
    What the table lists: the standard services for this kind of property,
    then any added to this proposal alone (DEV-260), which are a number of
    visits a year like a PPM service.
  */
  const listed: (Pick<AmcService, "id" | "label" | "frequencyType" | "category" | "unitOfMeasure"> & {
    custom: boolean;
  })[] = [
    ...availableServices.map((service) => ({ ...service, custom: false })),
    ...serviceRows.filter(isCustomServiceRow).map((row) => ({
      id: row.serviceId,
      label: row.customName?.trim() || "Custom service",
      frequencyType: "fixed" as const,
      category: "Custom services",
      unitOfMeasure: undefined,
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

  /*
    Visits a year are typed (23 Nov 2026, the user): a number the card does
    not list is kept and marked for approval, not moved to the nearest one
    the card allows. A proposal started from an enquiry or a site visit is
    still put on the card's numbers when it is made (snapToCardFrequencies).
  */

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
                    <TableHead className="w-[120px]">{rateCard ? "Rate" : "Base price"}</TableHead>
                    <TableHead className="w-[120px]">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listed.map((service, index) => {
                    const rowIndex = serviceRows.findIndex(
                      (row) => row.serviceId === service.id,
                    );
                    const row = serviceRows[rowIndex];
                    if (!row) return null;

                    const price = computeServiceRowPrice(row);
                    const frequencyEditable = isFrequencyEditable(
                      service.frequencyType,
                    );
                    /*
                      The Scope of Works Library's groups (HVAC, MEP,
                      cleaning, ...), each opened by a row of its own so
                      thirty-odd services can be scanned.
                    */
                    /* DEV-501: a rate typed above the card needs a reason, asked on a line of its own under the row (25 Nov 2026). */
                    const needsReason =
                      row.included && !row.free && row.rateOverride && row.standardRate != null && row.basePrice != null && row.basePrice > row.standardRate;
                    const groupStarts =
                      Boolean(service.category) && service.category !== listed[index - 1]?.category;

                    return (
                      <Fragment key={service.id}>
                      {groupStarts ? (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell
                            colSpan={7}
                            className="text-muted-foreground py-2 text-[11px] font-semibold tracking-wide uppercase"
                          >
                            {service.category}
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {/*
                        Centred (24 Nov 2026, the user). A caption under a field ("hours a
                        year", "Not on the card") hangs below it instead of taking room, so
                        every field sits on the row's middle line, captioned or not.
                      */}
                      <TableRow className={needsReason ? "border-b-0" : undefined}>
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
                                <SquarePen className="size-3.5" />
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
                          {/* What one unit is, so the units entered mean the same thing every time. */}
                          {service.unitOfMeasure ? (
                            <span className="text-muted-foreground mt-0.5 block text-[11px]">
                              {service.unitOfMeasure}
                            </span>
                          ) : null}
                          {/*
                            DEV-261: what the service covers here, as the
                            signed contracts name it. Only on a ticked row,
                            since only those print.
                          */}
                          {/*
                            Equipment is entered in the Details dialog with the visit details
                            (24 Nov 2026). A custom service, or a proposal with no property on
                            file, has no dialog, so it keeps the field here.
                          */}
                          {row.included ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {service.custom || !propertyRecordId ? (
                            /*
                              Labelled inside the field, so a value such as
                              "98" still reads as the equipment and not as
                              a stray number beside the service name.
                            */
                            <InputGroup className="h-8 w-full max-w-[260px] rounded-[12px]">
                              <InputGroupAddon className="text-muted-foreground gap-1.5 pr-0 text-[11px] font-medium">
                                <Wrench className="size-3.5" aria-hidden />
                                Equipment
                              </InputGroupAddon>
                              <InputGroupInput
                                className="h-8 text-xs md:text-xs"
                                placeholder="e.g. 10 FCU"
                                maxLength={80}
                                aria-label={`Equipment for ${service.label}`}
                                value={row.equipment ?? ""}
                                onChange={(event) =>
                                  updateRow(service.id, { equipment: event.target.value })
                                }
                              />
                            </InputGroup>
                            ) : null}
                            {/* The line's equipment and visit details (months, days, duration) in one dialog. */}
                            {!service.custom && propertyRecordId ? (
                              <ServiceScopeButton
                                propertyId={propertyRecordId}
                                serviceId={service.id}
                                label={service.label}
                                units={row.units}
                                frequency={row.frequency}
                                equipment={row.equipment}
                                onEquipmentChange={(equipment) => updateRow(service.id, { equipment })}
                              />
                            ) : null}
                          </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="h-8 min-w-16 text-xs"
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
                          <FieldWithNotes
                            notes={
                              <>
                              {/* What the card lists, so a number outside it is a choice, not a surprise. */}
                              {row.included && (allowedFrequencies?.(service.id).length ?? 0) > 0 ? (
                                <span className={cn("block text-[11px]", row.frequencyOffCard ? "text-warning" : "text-muted-foreground")}>
                                  Card: {allowedFrequencies!(service.id).join(", ")}
                                </span>
                              ) : null}
                              {/* What the number counts, where it is not visits a year. */}
                              {FREQUENCY_UNIT[service.frequencyType] ? (
                                <span className="text-muted-foreground block text-[11px]">{FREQUENCY_UNIT[service.frequencyType]}</span>
                              ) : null}
                              </>
                            }
                          >
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              className="h-8 min-w-16 text-xs"
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
                          </FieldWithNotes>
                          ) : null}
                          {frequencyEditable ? null : (
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
                          ) : rateCard && !service.custom ? (
                            /*
                              Always a box (16 Nov 2026): filled in with the card's
                              rate when it has one, empty when it does not. Typing
                              changes it for this proposal; under the card's floor,
                              or off the card, the proposal goes for approval. The
                              arrow puts the card's rate back.
                            */
                            <div className="text-xs">
                              <FieldWithNotes
                                notes={
                                  <>
                              {row.rateOverride && row.standardRate != null ? (
                                <span className="text-muted-foreground text-[10px]">Card {formatCurrencyAED(row.standardRate)}</span>
                              ) : null}
                              {row.rateOverride && row.standardRate != null ? null : row.standardRate == null && !row.rateItemId ? (
                                <span className={row.included && row.basePrice === undefined ? "text-destructive text-[10px]" : "text-muted-foreground text-[10px]"}>Not on the card</span>
                              ) : null}
                              {row.promotionPercent && !row.rateOverride ? (
                                <Badge variant="secondary" className="bg-success/10 text-success w-fit border-0 px-1.5 py-0 text-[10px] font-medium">
                                  Promotion −{row.promotionPercent}%
                                </Badge>
                              ) : null}
                                  </>
                                }
                              >
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="h-8 w-24 text-xs tabular-nums"
                                  placeholder={row.standardRate != null || row.rateItemId ? "0.00" : "Enter rate"}
                                  disabled={!row.included}
                                  aria-label={`Rate for ${service.label}`}
                                  aria-invalid={flagUnpriced && row.included && row.basePrice === undefined ? true : undefined}
                                  value={row.basePrice ?? ""}
                                  onChange={(event) =>
                                    updateRow(service.id, {
                                      rateOverride: true,
                                      basePrice: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)),
                                    })
                                  }
                                />
                                {row.rateOverride && row.standardRate != null ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 shrink-0"
                                    title="Use the card's rate"
                                    aria-label={`Use the card's rate for ${service.label}`}
                                    onClick={() => updateRow(service.id, { rateOverride: false, basePrice: undefined })}
                                  >
                                    <RotateCcw className="size-3.5" />
                                  </Button>
                                ) : null}
                              </div>
                              </FieldWithNotes>
                            </div>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 min-w-20 text-xs"
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
                        <TableCell className="text-xs font-medium tabular-nums">
                          {row.included && !row.free && row.basePrice === undefined ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatCurrencyAED(price)
                          )}
                          {row.included && row.belowFloor ? (
                            <div className="text-warning text-[10px] font-normal" title={row.floorRate != null ? `Floor rate ${formatCurrencyAED(row.floorRate)}` : undefined}>
                              {row.frequencyOffCard
                                ? "Visits off the card: needs approval"
                                : row.rateOverride
                                  ? row.floorRate != null
                                    ? "Below the floor: needs approval"
                                    : "Off the card: needs approval"
                                  : "Below floor after discount"}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                      {needsReason ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell />
                          <TableCell colSpan={6} className="pt-0 pb-3">
                            {/*
                              Quiet (25 Nov 2026, the user: "no red border, it looks rough"): a soft
                              panel that says what was typed against the card, then the reason.
                              Submit still refuses an empty one, and says so.
                            */}
                            <div className="bg-muted/30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border px-3 py-2.5">
                              <div className="flex min-w-0 items-start gap-2">
                                <MessageSquareText className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                                <div className="grid gap-0.5">
                                  <Label htmlFor={`why-${service.id}`} className="text-sm font-medium">
                                    Reason for the higher rate
                                  </Label>
                                  <span className="text-muted-foreground text-xs tabular-nums">
                                    Card AED {(row.standardRate ?? 0).toFixed(2)} · typed AED {(row.basePrice ?? 0).toFixed(2)}
                                    {row.rateOverrideBy ? ` · by ${row.rateOverrideBy}` : ""}
                                  </span>
                                </div>
                              </div>
                              <Input
                                id={`why-${service.id}`}
                                className="h-9 min-w-56 flex-1 rounded-[12px] text-sm"
                                maxLength={300}
                                placeholder="e.g. Agreed with the client for a larger site; needed to submit"
                                value={row.rateOverrideReason ?? ""}
                                title={row.rateOverrideBy ? `Typed by ${row.rateOverrideBy}` : undefined}
                                onChange={(event) => updateRow(service.id, { rateOverrideReason: event.target.value })}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      </Fragment>
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
        {discountNote}

        <Separator />

        <div className="flex justify-between text-sm font-semibold">
          <span>Final price</span>
          <span>{formatCurrencyAED(totals.finalPrice)}</span>
        </div>
      </div>

      {availableServices.length !== enabledCount && (
        <p className="text-xs text-muted-foreground">
          Services not offered on this kind of property are hidden.
        </p>
      )}
    </div>
  );
}

/**
 * A field on its row's middle line with its notes under it (24 Nov 2026).
 * The notes ("hours a year", "Not on the card") are mirrored, unseen, above
 * the field, so the field stays centred whether it has notes or not, and the
 * row grows to hold them instead of the notes running over the row's line.
 */
function FieldWithNotes({ notes, children }: { notes: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div aria-hidden className="invisible grid gap-0.5 whitespace-nowrap select-none">
        {notes}
      </div>
      {children}
      <div className="grid gap-0.5 whitespace-nowrap">{notes}</div>
    </div>
  );
}
