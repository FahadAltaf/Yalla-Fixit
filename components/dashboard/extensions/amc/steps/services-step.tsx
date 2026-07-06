"use client";

import { AlertTriangle, ListChecks } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import MultipleSelector, { type Option } from "@/components/ui/multiselect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  AMC_PACKAGES,
  AMC_SERVICES,
  getServicesForUnitType,
} from "../amc-constants";
import { buildDefaultFrequencyForService } from "../amc-pricing";
import type { AmcFormData } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function ServicesStep({ form }: StepProps) {
  const unitType = form.watch("unitType");
  const packageId = form.watch("packageId");
  const propertyCategory = form.watch("propertyCategory");
  const selectedServices = form.watch("selectedServices");
  const serviceFrequencies = form.watch("serviceFrequencies");
  const availableServices = getServicesForUnitType(unitType);
  const selectedPackage = AMC_PACKAGES.find((pkg) => pkg.id === packageId);

  const serviceOptions: Option[] = availableServices.map((service) => ({
    value: service.id,
    label: service.label,
  }));

  const selectedOptions: Option[] = selectedServices
    .map((id) => {
      const service = AMC_SERVICES.find((item) => item.id === id);
      return service ? { value: service.id, label: service.label } : null;
    })
    .filter((option): option is Option => Boolean(option));

  const syncFrequenciesForSelection = (serviceIds: string[]) => {
    const current = form.getValues("serviceFrequencies") ?? {};
    const next: Record<string, string> = {};

    for (const serviceId of serviceIds) {
      if (current[serviceId]?.trim()) {
        next[serviceId] = current[serviceId];
      } else {
        next[serviceId] = buildDefaultFrequencyForService(serviceId, {
          packageId,
          propertyCategory,
        });
      }
    }

    form.setValue("serviceFrequencies", next, { shouldValidate: true });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            Contract Services
          </CardTitle>
          <CardDescription>
            Select maintenance services for this AMC. Only selected services appear
            in the generated PDF. Frequencies are filled from the package but can
            be edited manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unitType !== "villa" && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">Villa-only services hidden</AlertTitle>
              <AlertDescription className="text-xs">
                Water pump, roof drain, and water tank services are only available
                for villa properties.
              </AlertDescription>
            </Alert>
          )}

          {propertyCategory === "residential" && !packageId && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">No package selected</AlertTitle>
              <AlertDescription className="text-xs">
                Select a package on the previous step to auto-fill PPM and handyman
                frequencies. You can still enter frequencies manually below.
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

          <FormField
            control={form.control}
            name="selectedServices"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Services</FormLabel>
                <FormControl>
                  <MultipleSelector
                    value={selectedOptions}
                    options={serviceOptions}
                    placeholder="Select services..."
                    hidePlaceholderWhenSelected
                    emptyIndicator={
                      <p className="text-center text-sm text-muted-foreground">
                        No services found.
                      </p>
                    }
                    onChange={(options) => {
                      const serviceIds = options.map((option) => option.value);
                      field.onChange(serviceIds);
                      syncFrequenciesForSelection(serviceIds);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      {selectedServices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Service Frequencies</CardTitle>
            <CardDescription>
              Edit frequencies before generating the contract PDF.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead className="w-[280px]">Frequency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedServices.map((serviceId) => {
                  const service = AMC_SERVICES.find((item) => item.id === serviceId);
                  if (!service) return null;

                  return (
                    <TableRow key={serviceId}>
                      <TableCell className="text-xs">{service.label}</TableCell>
                      <TableCell>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. 2 per year"
                          value={serviceFrequencies?.[serviceId] ?? ""}
                          onChange={(event) => {
                            form.setValue(
                              "serviceFrequencies",
                              {
                                ...form.getValues("serviceFrequencies"),
                                [serviceId]: event.target.value,
                              },
                              { shouldValidate: true }
                            );
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
