"use client";

import { Building2, UserRound, Users } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

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
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            Property Details
          </CardTitle>
          <CardDescription>
            Property type, location, and unit details for this AMC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="propertyCategory"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Property Category</FormLabel>
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

                  <FormLabel>Unit Type</FormLabel>
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

            <FormField
              control={form.control}
              name="propertyAddress"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Property Address</FormLabel>
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

            <FormField
              control={form.control}
              name="propertyDetail"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Property Detail</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Villa 12, Al Barsha, Dubai" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserRound className="size-4 text-primary" />
            Customer & Contract
          </CardTitle>
          <CardDescription>
            Client details, contract period, and proposal reference.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <FormItem className="flex flex-col">

                  <FormLabel>Customer Name</FormLabel>
                  <FormControl>
                    <Input placeholder="MR/MS. Customer Name" {...field} />
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
                    <Input placeholder="Customer reference ID (optional)" {...field} />
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
                    <Input placeholder="05X XXX XXXX" {...field} />
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
                  <FormLabel>Contract Start Date</FormLabel>
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
                  <FormLabel>Contract End Date</FormLabel>
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

                  <FormLabel>Payment Terms</FormLabel>
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

                  <FormLabel>Proposal Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. AMC-2026-1234" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4 text-primary" />
            Coordination Contacts
          </CardTitle>          <CardDescription>
            Two contact persons for day-to-day coordination on the contract.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                      <Input placeholder="05X XXX XXXX" {...field} />
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
                      <Input placeholder="05X XXX XXXX" {...field} />
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
        </CardContent>
      </Card>
    </div>
  );
}
