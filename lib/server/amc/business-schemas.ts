import { z } from "zod";

import { UNIT_TYPES, customerProfileFields, propertyExtraFields } from "@/lib/amc/client-profile";
import { SITE_VISIT_ATTENDANCE } from "@/lib/amc/enquiries";

/** Request bodies for the AMC business-operations routes. */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

export const customerSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the customer's name").max(200),
    customerRef: optionalText(60),
    company: optionalText(200),
    email: z.string().trim().email("Enter a valid email").max(200).nullable().optional().or(z.literal("")),
    phone: optionalText(40),
    notes: optionalText(2000),
    /* Phase 2 (BRD 5.9): identity and preferences. */
    ...customerProfileFields,
  })
  .strict();

export const propertySchema = z
  .object({
    label: z.string().trim().min(1, "Describe the property (e.g. Villa 12)").max(200),
    address: optionalText(300),
    community: optionalText(200),
    propertyCategory: z.enum(["residential", "commercial"]).nullable().optional(),
    bedrooms: z.number().int().min(0).max(100).nullable().optional(),
    sizeSqft: z.number().positive().max(10_000_000).nullable().optional(),
    notes: optionalText(2000),
    /* Phase 2 (BRD 5.2): unit-level address, floors and zones, occupancy, combined units. */
    ...propertyExtraFields,
  })
  .strict();

export const contractLinkSchema = z
  .object({
    kind: z.enum(["customer", "property"]),
    /** An existing record; null unlinks. */
    id: z.string().uuid().nullable().optional(),
    /** Make a new record from the signed snapshot instead. */
    createFromSnapshot: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !(v.id && v.createFromSnapshot), "Choose an existing record or create one, not both");

export const additionalServiceSchema = z
  .object({
    serviceKey: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers and dashes"),
    serviceLabel: z.string().trim().min(1, "Name the service").max(200),
    amcServiceId: z.string().trim().max(100).nullable().optional(),
    category: optionalText(100),
    date: isoDate,
    standardPrice: z.number().min(0).max(10_000_000).nullable(),
    notes: optionalText(1000),
  })
  .strict();

export const quoteActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link_estimate"), estimateNumber: z.string().trim().min(2).max(60) }).strict(),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3, "Give a reason").max(500) }).strict(),
]);

export const createAssessmentSchema = z
  .object({
    customerId: z.string().uuid().nullable(),
    propertyId: z.string().uuid().nullable(),
    contractId: z.string().uuid().nullable().optional(),
    assessorName: optionalText(200),
  })
  .strict()
  .refine((v) => v.customerId || v.propertyId, "Choose the customer or the property");

const assessmentResult = z.enum(["ok", "attention", "not_applicable"]);

export const updateAssessmentSchema = z
  .object({
    customerId: z.string().uuid().nullable().optional(),
    propertyId: z.string().uuid().nullable().optional(),
    assessedOn: isoDate.nullable().optional(),
    assessorName: optionalText(200),
    /* Site visit (DEV-362). */
    assessorId: z.string().uuid().nullable().optional(),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    attendance: z.enum(SITE_VISIT_ATTENDANCE).nullable().optional(),
    assetCounts: z.record(z.string().min(1).max(100), z.number().int().min(0).max(10_000)).optional(),
    accessNotes: optionalText(2000),
    exclusions: optionalText(2000),
    propertyCategory: z.enum(["residential", "commercial"]).nullable().optional(),
    unitType: z.enum(UNIT_TYPES).nullable().optional(),
    bedrooms: z.number().int().min(0).max(100).nullable().optional(),
    sizeSqft: z.number().positive().max(10_000_000).nullable().optional(),
    occupancy: z.enum(["occupied", "vacant", "unknown"]).nullable().optional(),
    summary: optionalText(2000),
    findings: optionalText(5000),
    notes: optionalText(5000),
    recommendedServiceIds: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    items: z
      .array(
        z
          .object({ itemKey: z.string().min(1).max(120), result: assessmentResult.nullable(), notes: optionalText(1000) })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict();

export const checklistItemSchema = z
  .object({
    itemKey: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(120).nullable().optional(),
    categoryLabel: z.string().trim().min(1, "Name the category").max(100),
    label: z.string().trim().min(1, "Name the item").max(200),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    active: z.boolean(),
  })
  .strict();

export const discountConfigSchema = z
  .object({
    enabled: z.boolean(),
    discountPercent: z.number().gt(0).max(100).nullable(),
    eligibleServiceKeys: z.array(z.string().trim().min(1).max(100)).max(200),
    eligibleCategories: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .strict();

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AMC notification settings (amc_notification_settings). */
export const notificationSettingsSchema = z.object({
  workflowEmailEnabled: z.boolean(),
  entitlementEmailEnabled: z.boolean(),
  reminderAutoEnabled: z.boolean(),
  reminderThresholds: z.array(z.number().int().min(1).max(365)).max(6),
  reminderRecipients: z.array(z.enum(["owner", "approvers"])).max(2),
  reminderChannels: z.array(z.enum(["in_app", "email"])).max(2),
  reminderExtraEmails: z.array(z.string().trim().email()).max(10),
});

