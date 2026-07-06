"use client";

import { addYears, format } from "date-fns";
import { UserRound } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { AmcFormData } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function CustomerStep({ form }: StepProps) {
  const startDate = form.watch("startDate");
  const endDate = startDate
    ? format(addYears(new Date(startDate), 1), "dd/MM/yyyy")
    : "—";

  return (
    <div className="space-y-4">
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
                <FormItem>
                  <FormLabel>Customer Name</FormLabel>
                  <FormControl>
                    <Input placeholder="MR/MS. ..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="customerPhone"
              render={({ field }) => (
                <FormItem>
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
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="customer@email.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contract Start Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem>
              <FormLabel>Contract End Date</FormLabel>
              <Input value={endDate} disabled />
            </FormItem>

            <FormField
              control={form.control}
              name="paymentTerms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Terms</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select terms" />
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
                <FormItem>
                  <FormLabel>Proposal Number</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
          <CardTitle className="text-base">Coordination Contacts</CardTitle>
          <CardDescription>
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
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.0.phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.0.designation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Designation</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl className="w-full">
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="tenant">Tenant</SelectItem>
                        <SelectItem value="representative">Representative</SelectItem>
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
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.1.phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coordinationContacts.1.designation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Designation</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl className="w-full">
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="tenant">Tenant</SelectItem>
                        <SelectItem value="representative">Representative</SelectItem>
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
