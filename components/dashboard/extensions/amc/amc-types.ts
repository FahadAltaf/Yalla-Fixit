import { z } from "zod";

export const propertyCategorySchema = z.enum(["residential", "commercial"]);
export const unitTypeSchema = z.enum(["villa", "apartment", "office"]);
export const paymentTermsSchema = z.enum(["monthly", "quarterly", "annual"]);
export const designationSchema = z.enum([
  "owner",
  "tenant",
  "representative",
]);

export const coordinationContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  designation: designationSchema,
});

export const amcFormSchema = z
  .object({
    propertyCategory: propertyCategorySchema,
    unitType: unitTypeSchema,
    propertyAddress: z.string().min(1, "Property address is required"),
    propertyDetail: z.string().min(1, "Property detail is required"),
    packageId: z.string().optional(),
    customMonthlyPrice: z.coerce.number().positive().optional(),
    selectedServices: z
      .array(z.string())
      .min(1, "Select at least one service"),
    serviceFrequencies: z.record(z.string(), z.string()),
    customerName: z.string().min(1, "Customer name is required"),
    customerId: z.string().optional(),
    customerPhone: z.string().min(1, "Customer phone is required"),
    customerEmail: z.string().email("Invalid email address"),
    coordinationContacts: z.tuple([
      coordinationContactSchema,
      coordinationContactSchema,
    ]),
    startDate: z.string().min(1, "Start date is required"),
    paymentTerms: paymentTermsSchema,
    proposalNumber: z.string().min(1, "Proposal number is required"),
  })
  .superRefine((data, ctx) => {
    if (data.propertyCategory === "residential" && !data.packageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please select a package",
        path: ["packageId"],
      });
    }
    if (data.propertyCategory === "commercial") {
      if (!data.customMonthlyPrice || data.customMonthlyPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please enter a monthly rate",
          path: ["customMonthlyPrice"],
        });
      }
    }

    for (const serviceId of data.selectedServices) {
      const frequency = data.serviceFrequencies?.[serviceId]?.trim();
      if (!frequency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a frequency for each selected service",
          path: ["serviceFrequencies"],
        });
        break;
      }
    }
  });

export type PropertyCategory = z.infer<typeof propertyCategorySchema>;
export type UnitType = z.infer<typeof unitTypeSchema>;
export type PaymentTerms = z.infer<typeof paymentTermsSchema>;
export type Designation = z.infer<typeof designationSchema>;
export type CoordinationContact = z.infer<typeof coordinationContactSchema>;
export type AmcFormData = z.infer<typeof amcFormSchema>;

export interface AmcPackage {
  id: string;
  name: string;
  slug: string;
  monthlyPrice: number;
  ppmVisitsPerYear: number;
  handymanHoursPerYear: number;
  propertyCategory: "residential";
}

export type AmcServiceFrequencyType =
  | "covered"
  | "unlimited"
  | "ppm"
  | "handyman"
  | "fixed";

export interface AmcService {
  id: string;
  label: string;
  scope: string;
  reference: string;
  frequencyType: AmcServiceFrequencyType;
  frequencyPerYear?: number;
  villaOnly: boolean;
  sectionNumber?: string;
  sectionTitle?: string;
  hasScopeSection: boolean;
}

export interface FrequencyRow {
  scope: string;
  frequency: string;
  reference: string;
}

export interface AmcTotals {
  monthlyPrice: number;
  annualSubtotal: number;
  vatAmount: number;
  grandTotal: number;
  amountInWords: string;
}

export interface AmcComputedData {
  packageName: string;
  packageTitle: string;
  propertyTypeLabel: string;
  proposalDate: string;
  endDate: string;
  totals: AmcTotals;
  frequencyRows: FrequencyRow[];
  formData: AmcFormData;
}
