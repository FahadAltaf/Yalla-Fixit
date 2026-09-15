import { z } from "zod";

import { isEndDateBeforeStartDate } from "./amc-date-utils";

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

/*
  FR4.5 / §8.3 — sections the team switches on per proposal. The other
  three optional sections in §8.3 (24/7 hotline, water pump, free
  handyman) are already service rows, so their own checkbox decides
  whether they print; only these two need a toggle of their own.

  additionalFixedPriceServices maps to clause 6.3, the out-of-hours
  handyman rates. §8.3 says "thought to be clause 6.3, see OI-5" -- OI-5
  is in the Open Issues register, which is missing from the PDF, so this
  mapping is unconfirmed.
*/
export const amcOptionalSectionsSchema = z.object({
  supplyInstallPriceList: z.boolean(),
  additionalFixedPriceServices: z.boolean(),
});

/* FR4.6 — the rows behind clause 6.2, filled in when that section is on. */
export const amcPriceListRowSchema = z.object({
  category: z.string(),
  description: z.string(),
  brand: z.string(),
  price: z.string(),
});

/* FR4.4 / §8.2 — the account manager named in clause 1.1, entered per
   proposal. The other placeholders in §8.2 are standing org values and
   come from AMC Settings in phase 3. */
export const amcAccountManagerSchema = z.object({
  name: z.string(),
  phone: z.string(),
});

export const amcServiceRowSchema = z.object({
  serviceId: z.string().min(1),
  included: z.boolean(),
  units: z.coerce.number().int().min(1, "Units must be at least 1"),
  frequency: z.coerce.number().int().min(1, "Frequency must be at least 1"),
  /*
    FR2.4: entered per proposal, replacing the unitRate constant. Optional
    here and enforced per row in superRefine, so an unchecked row is never
    asked for a price. Zero is valid and meaningful -- FR2.12 calls out
    the free handyman service.
  */
  basePrice: z.coerce.number().min(0, "Base price cannot be negative").optional(),
  price: z.coerce.number().min(0).optional(),
});

export const amcFormSchema = z
  .object({
    propertyCategory: propertyCategorySchema,
    unitType: unitTypeSchema,
    propertyAddress: z.string().min(1, "Property address is required"),
    propertyDetail: z.string().min(1, "Property detail is required"),
    serviceRows: z.array(amcServiceRowSchema),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
    optionalSections: amcOptionalSectionsSchema,
    priceListRows: z.array(amcPriceListRowSchema),
    accountManagers: z.tuple([amcAccountManagerSchema, amcAccountManagerSchema]),
    customerName: z.string().min(1, "Customer name is required"),
    /* FR4.4 / §8.2: prints in the contract header, where it used to
       fall back to "XXX". Required now. */
    customerId: z.string().min(1, "Customer ID is required"),
    customerPhone: z.string().min(1, "Customer phone is required"),
    customerEmail: z.string().email("Invalid email address"),
    coordinationContacts: z.tuple([
      coordinationContactSchema,
      coordinationContactSchema,
    ]),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    paymentTerms: paymentTermsSchema,
    proposalNumber: z.string().min(1, "Proposal number is required"),
    submissionId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    const includedRows = data.serviceRows.filter((row) => row.included);
    if (includedRows.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one service",
        path: ["serviceRows"],
      });
    }

    for (const row of includedRows) {
      /*
        FR2.12: every checked row needs a base price before submission.
        Checked explicitly against undefined -- 0 is a valid price (a
        service given free), and a falsy test would reject it.
      */
      if (row.basePrice === undefined || Number.isNaN(row.basePrice)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a base price for every selected service",
          path: ["serviceRows"],
        });
        break;
      }
      if (row.units < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Units must be a positive integer",
          path: ["serviceRows"],
        });
        break;
      }
      if (row.frequency < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Frequency must be a positive integer",
          path: ["serviceRows"],
        });
        break;
      }
    }

    if (data.optionalSections.supplyInstallPriceList) {
      const filled = data.priceListRows.filter(
        (row) =>
          row.category.trim() ||
          row.description.trim() ||
          row.brand.trim() ||
          row.price.trim(),
      );
      if (filled.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Add at least one price list row, or switch the supply and installation section off",
          path: ["priceListRows"],
        });
      }
    }

    if (
      data.startDate &&
      data.endDate &&
      isEndDateBeforeStartDate(data.startDate, data.endDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contract end date cannot be before the start date",
        path: ["endDate"],
      });
    }
  });

export type PropertyCategory = z.infer<typeof propertyCategorySchema>;
export type UnitType = z.infer<typeof unitTypeSchema>;
export type PaymentTerms = z.infer<typeof paymentTermsSchema>;
export type Designation = z.infer<typeof designationSchema>;
export type CoordinationContact = z.infer<typeof coordinationContactSchema>;
export type AmcServiceRow = z.infer<typeof amcServiceRowSchema>;
export type AmcOptionalSections = z.infer<typeof amcOptionalSectionsSchema>;
export type AmcPriceListRow = z.infer<typeof amcPriceListRowSchema>;
export type AmcAccountManager = z.infer<typeof amcAccountManagerSchema>;
export type AmcFormData = z.infer<typeof amcFormSchema>;

export type AmcServiceFrequencyType =
  | "covered"
  | "unlimited"
  | "ppm"
  | "handyman"
  | "fixed";

export type AmcDocumentType = "proposal" | "contract";

export interface AmcService {
  id: string;
  label: string;
  scope: string;
  reference: string;
  frequencyType: AmcServiceFrequencyType;
  /* The default the table starts at (FR2.3). No unitRate any more: price
     comes from the base price entered per proposal (FR2.4). */
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
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  monthlyPrice: number;
  annualSubtotal: number;
  vatAmount: number;
  grandTotal: number;
  amountInWords: string;
}

export interface AmcComputedData {
  documentType: AmcDocumentType;
  documentTitle: string;
  propertyTypeLabel: string;
  proposalDate: string;
  endDate: string;
  totals: AmcTotals;
  frequencyRows: FrequencyRow[];
  formData: AmcFormData;
}

export type AmcSubmissionStatus = "draft" | "generated";

export interface AmcSubmissionProperty {
  propertyCategory: PropertyCategory;
  unitType: UnitType;
  propertyAddress: string;
  propertyDetail: string;
}

export interface AmcSubmissionDocumentOptions {
  optionalSections: AmcOptionalSections;
  priceListRows: AmcPriceListRow[];
  accountManagers: [AmcAccountManager, AmcAccountManager];
}

export interface AmcSubmissionCustomer {
  customerName: string;
  customerId?: string;
  customerPhone: string;
  customerEmail: string;
  coordinationContacts: [CoordinationContact, CoordinationContact];
  startDate: string;
  endDate: string;
  paymentTerms: PaymentTerms;
  proposalNumber: string;
}

/* Omit rather than extend: the form's basePrice is number | undefined
   (not yet typed), while the persisted one is number | null (not entered).
   Same idea, different absent-value convention -- JSON has no undefined. */
export interface AmcSubmissionServiceRow extends Omit<AmcServiceRow, "basePrice"> {
  /*
    FR3.1: the submission stores what was entered, so reopening it
    restores the figures exactly (FR3.3). Nullable on purpose: drafts
    autosave continuously, and a row the team has not priced yet must
    come back unpriced rather than as a free service. Null is "not
    entered", 0 is "free".
  */
  basePrice: number | null;
  price: number;
}

export interface AmcSubmission {
  id: string;
  owner_id: string;
  status: AmcSubmissionStatus;
  property: AmcSubmissionProperty;
  customer: AmcSubmissionCustomer;
  /* FR3.1: optional sections and placeholder values are part of the
     submission, so reopening one restores the document exactly. */
  document_options: AmcSubmissionDocumentOptions;
  services: AmcSubmissionServiceRow[];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents: AmcDocumentType[];
  created_at: string;
  updated_at: string;
}

export interface AmcSubmissionListResponse {
  submissions: AmcSubmission[];
  totalCount: number;
}
