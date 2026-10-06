"use client";

import { useEffect } from "react";
import { Building2, UserRound, Users } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AmcPhoneInput } from "../components/amc-phone-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { getDefaultEndDate, unitTypesForCategory } from "../amc-constants";
import { isEndDateBeforeStartDate } from "../amc-date-utils";
import { DatePickerField } from "../components/date-picker-field";
import type { AmcFormData } from "../amc-types";

/**
 * What the wizard means by a required field.
 *
 * The form told nobody which fields it would refuse to move on without:
 * every label looked the same, and the first anyone heard of it was a row
 * of red under the ones they had skipped. Same mark and same colour as
 * the snagging wizard, so one convention covers the product.
 *
 * Only on fields that can actually be left blank. A select that opens
 * with a value is required too, and marking it would make the mark mean
 * nothing.
 */
function RequiredMark() {
  return (
    <span className="text-brand" aria-hidden>
      {" *"}
    </span>
  );
}

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function PropertyCustomerStep({ form }: StepProps) {
  const startDate = form.watch("startDate");
  /*
    Which unit types this category has (Behrouz, Oct 2026): an office is
    commercial, a villa and an apartment are not. The list used to offer
    all three whatever the category, so "Residential - OFFICE" was one
    stray click away and prints as the document's own banner.
  */
  const propertyCategory = form.watch("propertyCategory");
  const unitType = form.watch("unitType");
  const unitTypes = unitTypesForCategory(propertyCategory);

  /*
    Changing the category can leave the unit type behind. Moved to the
    first type the new category offers rather than cleared, because the
    field is required and an empty required field right after a change
    the user did not make reads as an error they caused.
  */
  useEffect(() => {
    if (!unitTypes.some((type) => type.value === unitType)) {
      form.setValue("unitType", unitTypes[0].value, { shouldValidate: true });
    }
  }, [form, unitType, unitTypes]);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="text-brand size-4" />
            Property details
          </h3>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Property type, location, and unit details for this AMC.
          </p>
        </div>
        <div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField
              control={form.control}
              name="propertyCategory"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Property category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl className="w-full">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="residential">Residential</SelectItem>
                      <SelectItem value="commercial">Commercial</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Sets which unit types are offered, and prints in the
                    document&apos;s banner.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="unitType"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Unit type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl className="w-full">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select unit type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {unitTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Decides which services the next step offers: water pump,
                    roof drain and water tank work are villas only.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Category, unit type and the short detail side by side;
                the full address gets the whole row under them. */}
            <FormField
              control={form.control}
              name="propertyDetail"
              render={({ field }) => (
                <FormItem className="sm:col-span-2 xl:col-span-1">
                  <FormLabel>
                    Property name
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Villa 12, Al Barsha" {...field} />
                  </FormControl>
                  {/*
                    Both fields are an address of a kind, and the old
                    labels -- "Property detail" and "Property address" --
                    did not say which was which or where either one
                    surfaced. Each now names the line it prints as.
                  */}
                  <FormDescription>
                    The short name, printed as Property Detail in the
                    contract&apos;s details table.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="propertyAddress"
              render={({ field }) => (
                <FormItem className="sm:col-span-2 xl:col-span-3">
                  <FormLabel>
                    Customer address
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Full address, as it should read on the contract"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The full address, printed as Customer Address on the
                    contract.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <UserRound className="text-brand size-4" />
            Customer and contract
          </h3>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Client details, contract period, and proposal reference.
          </p>
        </div>
        <div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>
                    Customer name
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Mr. Ahmed Khan" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>
                    Customer ID
                    <RequiredMark />
                  </FormLabel>
                  <FormControl className="">
                    <Input placeholder="e.g. YFI1806" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="customerPhone"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>
                    Phone
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <AmcPhoneInput
                      id={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={field.disabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="customerEmail"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>
                    Email
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="customer@email.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>
                    Contract start date
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <DatePickerField
                      value={field.value}
                      placeholder="Select start date"
                      onChange={(nextStartDate) => {
                        field.onChange(nextStartDate);

                        const currentEndDate = form.getValues("endDate");
                        if (
                          nextStartDate &&
                          currentEndDate &&
                          isEndDateBeforeStartDate(
                            nextStartDate,
                            currentEndDate,
                          )
                        ) {
                          form.setValue(
                            "endDate",
                            getDefaultEndDate(nextStartDate),
                            { shouldValidate: true },
                          );
                        } else {
                          void form.trigger("endDate");
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>
                    Contract end date
                    <RequiredMark />
                  </FormLabel>
                  <FormControl>
                    <DatePickerField
                      value={field.value}
                      minDate={startDate}
                      disabled={!startDate}
                      placeholder={
                        startDate
                          ? "Select end date"
                          : "Select start date first"
                      }
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentTerms"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Payment terms</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl className="w-full">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select payment terms" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="proposalNumber"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Proposal number</FormLabel>
                  <FormControl>
                    {/* Step 1.7 — allocated by the server so two proposals
                        can never share a reference. Read-only, and blank
                        until the first save. */}
                    <Input
                      {...field}
                      readOnly
                      tabIndex={-1}
                      className="bg-muted/50 text-muted-foreground"
                      placeholder="Assigned automatically when saved"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Users className="text-brand size-4" />
            Coordination contacts
          </h3>          <p className="text-muted-foreground mt-0.5 text-sm">
            Who the team coordinates with day to day. One is enough; add a
            second only if the client has one.
          </p>
        </div>
        <div className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">
              Contact Person 1
            </h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="coordinationContacts.0.name"
                render={({ field }) => (
                  <FormItem className="flex flex-col">

                    <FormLabel>
                      Name
                      <RequiredMark />
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Contact person name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.0.phone"
                render={({ field }) => (
                  <FormItem className="flex flex-col">

                    <FormLabel>
                      Phone
                      <RequiredMark />
                    </FormLabel>
                    <FormControl>
                      <AmcPhoneInput
                      id={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={field.disabled}
                    />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.0.designation"
                render={({ field }) => (
                  <FormItem className="flex flex-col">

                    <FormLabel>Designation</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl className="w-full">
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select designation" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="tenant">Tenant</SelectItem>
                        <SelectItem value="representative">
                          Representative
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">
              Contact Person 2{" "}
              <span className="font-normal">(optional)</span>
            </h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="coordinationContacts.1.name"
                render={({ field }) => (
                  <FormItem className="flex flex-col">

                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Contact person name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.1.phone"
                render={({ field }) => (
                  <FormItem className="flex flex-col">

                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <AmcPhoneInput
                      id={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={field.disabled}
                    />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.1.designation"
                render={({ field }) => (
                  <FormItem className="flex flex-col">

                    <FormLabel>Designation</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl className="w-full">
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select designation" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="tenant">Tenant</SelectItem>
                        <SelectItem value="representative">
                          Representative
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
