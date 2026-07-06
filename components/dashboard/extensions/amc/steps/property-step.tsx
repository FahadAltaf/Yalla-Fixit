"use client";

import { Building2 } from "lucide-react";
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

import type { AmcFormData } from "../amc-types";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

export function PropertyStep({ form }: StepProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="size-4 text-primary" />
          Property Details
        </CardTitle>
        <CardDescription>
          Define the property category, unit type, and location for this AMC.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="propertyCategory"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Property Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value} >
                  <FormControl className="w-full">
                    <SelectTrigger>
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
              <FormItem>
                <FormLabel>Unit Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl className="w-full">
                    <SelectTrigger>
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
                  <Textarea rows={2} placeholder="Full property address" {...field} />
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
                  <Input placeholder="e.g. 3BR villa, Al Barsha" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
