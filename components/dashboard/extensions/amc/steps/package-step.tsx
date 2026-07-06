"use client";

import { AlertTriangle, Check, Package } from "lucide-react";
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

import { AMC_PACKAGES } from "../amc-constants";
import { buildFrequenciesForServices } from "../amc-pricing";
import type { AmcFormData } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function PackageStep({ form }: StepProps) {
  const propertyCategory = form.watch("propertyCategory");

  if (propertyCategory === "commercial") {
    return (
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
                    placeholder="Enter quoted monthly rate"
                    value={field.value ?? ""}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value ? Number(event.target.value) : undefined
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
    );
  }

  return (
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
                No package is selected by default. Choose a tier to apply its PPM
                visits and handyman hours to service frequencies on the next step.
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
                        isSelected && "border-primary ring-1 ring-primary/30"
                      )}
                      onClick={() => {
                        field.onChange(pkg.id);
                        const values = form.getValues();
                        const selected = values.selectedServices;
                        if (selected.length > 0) {
                          form.setValue(
                            "serviceFrequencies",
                            buildFrequenciesForServices(selected, {
                              packageId: pkg.id,
                              propertyCategory: values.propertyCategory,
                            }),
                            { shouldValidate: true }
                          );
                        }
                      }}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base">{pkg.name}</CardTitle>
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
  );
}
