"use client";

import { AlertTriangle, ListChecks, SlidersHorizontal, UserRound } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ServiceTable } from "../components/service-table";
import { emptyPriceListRow } from "../amc-constants";
import type { AmcFormData, AmcPriceListRow } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

/**
 * Step 2 — Services and Pricing (FR1.1, FR1.3, §5.1).
 *
 * Replaces PackageServicesStep. The package picker and the commercial
 * monthly-rate field are both gone (FR2.6): the step opens straight on the
 * service table, and every price comes from the base price entered per row
 * (FR2.4).
 *
 * The commercial rate field is worth a note, because deleting a required
 * field looks like a regression. It was required by validation, stored and
 * round-tripped — and never read by any pricing function, so the number the
 * team was forced to enter never reached the document. FR2.6 removes the
 * concept rather than wiring it up.
 *
 * §5.1 also puts the optional sections and the placeholder fields on this
 * step, which is why they are below rather than on Review.
 */
export function ServicesPricingStep({ form }: StepProps) {
  const unitType = form.watch("unitType");
  const showPriceList = form.watch("optionalSections.supplyInstallPriceList");
  const priceListRows = form.watch("priceListRows") ?? [];

  const updatePriceListRow = (
    index: number,
    patch: Partial<AmcPriceListRow>,
  ) => {
    const next = priceListRows.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    form.setValue("priceListRows", next, { shouldValidate: true });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            Contract Services
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Tick each service this AMC covers, then set its units, visits per
            year and base price. Price is base price × units × frequency and
            updates as you type.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* FR1.4 — villa-only services stay hidden for apartments and
              offices. Naming them, so an absence reads as a rule rather
              than as a missing row. */}
          {unitType !== "villa" && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">
                Villa-only services hidden
              </AlertTitle>
              <AlertDescription className="text-xs">
                Water pump maintenance, roof drain cleaning and water tank
                cleaning apply to villas only.
              </AlertDescription>
            </Alert>
          )}

          <ServiceTable form={form} />
        </CardContent>
      </Card>

      {/* FR4.4 / §8.2 — clause 1.1 named two account managers as
          "05X XXX XXX – NAME". Entered here, per client. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserRound className="size-4 text-primary" />
            Account Managers
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Printed in clause 1.1 as the client&apos;s direct contacts. Leave
            the second blank if there is only one.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {([0, 1] as const).map((index) => (
            <div key={index} className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Contact {index + 1}
              </p>
              <FormField
                control={form.control}
                name={`accountManagers.${index}.name` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Name</FormLabel>
                    <FormControl>
                      <Input className="h-8 text-xs" placeholder="Full name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`accountManagers.${index}.phone` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Direct number</FormLabel>
                    <FormControl>
                      <Input className="h-8 text-xs" placeholder="05X XXX XXXX" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* FR4.5 / §8.3 — a section that is switched off is left out of the
          document completely. The other three optional sections are service
          rows, so their own checkbox above already decides. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" />
            Optional Contract Sections
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Switched off by default. A section that is off does not appear in
            the contract at all.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            control={form.control}
            name="optionalSections.supplyInstallPriceList"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <FormLabel className="text-sm">
                    Supply and installation price list
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Clause 6.2. Fill in the rows below when this is on.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Include the supply and installation price list"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {showPriceList && (
            <FormField
              control={form.control}
              name="priceListRows"
              render={() => (
                <FormItem>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">No.</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[130px]">Brand</TableHead>
                          <TableHead className="w-[120px]">Price (AED)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {priceListRows.map((row, index) => (
                          <TableRow key={index}>
                            <TableCell className="text-xs text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            {(
                              [
                                ["category", "e.g. Plumbing"],
                                ["description", "e.g. Mixer tap replacement"],
                                ["brand", "e.g. Grohe"],
                                ["price", "0.00"],
                              ] as const
                            ).map(([key, placeholder]) => (
                              <TableCell key={key}>
                                <Input
                                  className="h-8 text-xs"
                                  placeholder={placeholder}
                                  aria-label={`${key} for price list row ${index + 1}`}
                                  value={row[key]}
                                  onChange={(event) =>
                                    updatePriceListRow(index, {
                                      [key]: event.target.value,
                                    })
                                  }
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Blank rows are dropped when the contract renders, so
                      three empty rows cost nothing but an unused row. */}
                  <button
                    type="button"
                    className="text-primary mt-2 text-xs font-medium hover:underline"
                    onClick={() =>
                      form.setValue(
                        "priceListRows",
                        [...priceListRows, emptyPriceListRow()],
                        { shouldValidate: true },
                      )
                    }
                  >
                    Add another row
                  </button>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="optionalSections.additionalFixedPriceServices"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <FormLabel className="text-sm">
                    Additional fixed price services
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Clause 6.3 — the hourly rates for handyman work beyond the
                    free hours.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Include additional fixed price services"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
