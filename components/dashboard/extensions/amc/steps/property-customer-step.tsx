"use client";

import { Building2, UserRound, Users } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
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

import { getDefaultEndDate } from "../amc-constants";
import { isEndDateBeforeStartDate } from "../amc-date-utils";
import { DatePickerField } from "../components/date-picker-field";
import type { AmcFormData } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function PropertyCustomerStep({ form }: StepProps) {
  const startDate = form.watch("startDate");

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
                      <SelectItem value="villa">Villa</SelectItem>
                      <SelectItem value="apartment">Apartment</SelectItem>
                      <SelectItem value="office">Office</SelectItem>
                    </SelectContent>
                  </Select>
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
                  <FormLabel>Property detail</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Villa 12, Al Barsha, Dubai" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="propertyAddress"
              render={({ field }) => (
                <FormItem className="sm:col-span-2 xl:col-span-3">
                  <FormLabel>Property address</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Full property address"
                      {...field}
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

                  <FormLabel>Customer name</FormLabel>
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
                  <FormLabel>Customer ID</FormLabel>
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
              name="customerEmail"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Email</FormLabel>
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
                  <FormLabel>Contract start date</FormLabel>
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
                  <FormLabel>Contract end date</FormLabel>
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
            The two people the team coordinates with day to day.
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
                name="coordinationContacts.0.phone"
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
              Contact Person 2
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
