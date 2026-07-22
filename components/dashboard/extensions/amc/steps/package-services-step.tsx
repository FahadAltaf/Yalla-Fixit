"use client";

import { AlertTriangle, Check, ListChecks, Package } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ServiceTable } from "../components/service-table";
import { AMC_PACKAGES } from "../amc-constants";
import { refreshServiceRowFrequencies } from "../amc-pricing";
import type { AmcFormData } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function PackageServicesStep({ form }: StepProps) {
  const propertyCategory = form.watch("propertyCategory");
  const unitType = form.watch("unitType");
  const packageId = form.watch("packageId");
  const selectedPackage = AMC_PACKAGES.find((pkg) => pkg.id === packageId);

  const handlePackageSelect = (id: string) => {
    form.setValue("packageId", id, { shouldValidate: true });
    const currentRows = form.getValues("serviceRows");
    form.setValue(
      "serviceRows",
      refreshServiceRowFrequencies(
        currentRows,
        id,
        form.getValues("propertyCategory"),
      ),
      { shouldValidate: true },
    );
  };

  return (
    <div className="space-y-4">
      {propertyCategory === "commercial" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="size-4 text-primary" />
              Commercial Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">
                Commercial property selected
              </AlertTitle>
              <AlertDescription className="text-xs">
                Enter a custom monthly rate for this commercial AMC contract.
              </AlertDescription>
            </Alert>

            <FormField
              control={form.control}
              name="customMonthlyPrice"
              render={({ field }) => (
                <FormItem className="max-w-sm">
                  <FormLabel>Monthly Rate (AED)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Enter monthly rate in AED"
                      value={field.value ?? ""}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
      ) : (
        <FormField
          control={form.control}
          name="packageId"
          render={({ field }) => (
            <FormItem>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="size-4 text-primary" />
                    Select Package
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Choose a tier to apply its PPM visits and handyman hours to
                    service frequencies in the table below.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {AMC_PACKAGES.map((pkg) => {
                      const isSelected = field.value === pkg.id;
                      return (
                        <Card
                          key={pkg.id}
                          className={cn(
                            "cursor-pointer transition-colors hover:border-primary/50",
                            isSelected &&
                              "border-primary ring-1 ring-primary/30",
                          )}
                          onClick={() => handlePackageSelect(pkg.id)}
                        >
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="text-base">
                                {pkg.name}
                              </CardTitle>
                              {isSelected && (
                                <Badge variant="default" className="shrink-0">
                                  <Check className="mr-1 size-3" />
                                  Selected
                                </Badge>
                              )}
                            </div>
                            <p className="text-2xl font-semibold text-primary">
                              AED {pkg.monthlyPrice}
                              <span className="text-sm font-normal text-muted-foreground">
                                /mo
                              </span>
                            </p>
                          </CardHeader>
                          <CardContent className="space-y-1 text-sm text-muted-foreground">
                            <p>{pkg.ppmVisitsPerYear} PPM visit(s) per year</p>
                            <p>{pkg.handymanHoursPerYear} free handyman hrs/yr</p>
                            <p>24/7 helpdesk & unlimited call-outs</p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            Contract Services
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Select services, set units and frequency. Prices update automatically
            when unit rates are configured.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {unitType !== "villa" && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">
                Villa-only services hidden
              </AlertTitle>
              <AlertDescription className="text-xs">
                Water pump, roof drain, and water tank services are only
                available for villa properties.
              </AlertDescription>
            </Alert>
          )}

          {propertyCategory === "residential" && !packageId && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">
                No package selected
              </AlertTitle>
              <AlertDescription className="text-xs">
                Select a package above to auto-fill PPM and handyman frequencies.
              </AlertDescription>
            </Alert>
          )}

          {selectedPackage && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              Package <strong>{selectedPackage.name}</strong>:{" "}
              {selectedPackage.ppmVisitsPerYear} PPM visit(s)/yr,{" "}
              {selectedPackage.handymanHoursPerYear} handyman hr(s)/yr
            </div>
          )}

          <ServiceTable form={form} />
        </CardContent>
      </Card>
    </div>
  );
}
