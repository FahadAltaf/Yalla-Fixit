import { z } from "zod";

import { UNIT_TYPES } from "@/lib/amc/client-profile";
import { PAYMENT_PLANS, customPlanSchema, type CustomPlan, type PaymentPlan, type VersionReason } from "@/lib/amc/proposal-rules";

import { isEndDateBeforeStartDate } from "./amc-date-utils";
import type { AmcSettings } from "./amc-settings";

export const propertyCategorySchema = z.enum(["residential", "commercial"]);
export const unitTypeSchema = z.enum(["villa", "apartment", "office"]);
export const paymentTermsSchema = z.enum(["monthly", "quarterly", "annual"]);
/*
  A contact's designation: one of the usual three, or whatever the client
  calls them (Sharon, UAT AMC-099: "Operation Manager"). Stored as typed;
  the presets keep their old values so saved proposals read the same.
*/
export const DESIGNATION_PRESETS = [
  { value: "owner", label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "representative", label: "Representative" },
] as const;
export const designationSchema = z
  .string()
  .trim()
  .max(60, "Keep the designation under 60 characters");

/* The service table names the services this refers to (AMC-057). */
export const BASE_PRICE_MESSAGE =
  "Enter a base price for every selected service, or tick Free";

/* How many coordination contacts a proposal can name (AMC-099). */
export const MAX_COORDINATION_CONTACTS = 6;

export const coordinationContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  designation: designationSchema.min(1, "Choose or type a designation"),
});

/*
  The second coordination contact, which is optional (Jonathan, Oct 2026).

  Most clients give one person. Asking for two made the form refuse to
  move on until a second name and number were invented, and invented
  contacts print on the contract. Blank is allowed here; superRefine
  below still insists on a number once a name is given, so a
  half-finished second contact cannot reach the document.
*/
export const optionalCoordinationContactSchema = z.object({
  name: z.string(),
  phone: z.string(),
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

/*
  What each service covers on the contract (BRD 5.7, DEV-373), keyed by
  service id. Set on the contract and mirrored into the proposal's
  document options so the contract document can print it; absent on
  proposals and on contracts made before it.
*/
export const amcEntitlementTermSchema = z.object({
  labourCovered: z.boolean(),
  materialCoverage: z.enum(["none", "consumables", "parts_within_limit", "all"]),
  valueLimitAed: z.number().nullable(),
  exclusions: z.string().nullable(),
});

export const amcServiceRowSchema = z.object({
  serviceId: z.string().min(1),
  included: z.boolean(),
  units: z.coerce
    .number()
    .int()
    .min(1, "Units must be at least 1")
    .max(10_000, "Units can be at most 10,000"),
  frequency: z.coerce
    .number()
    .int()
    .min(1, "Frequency must be at least 1")
    .max(1_000, "Frequency can be at most 1,000"),
  /*
    FR2.4: entered per proposal, replacing the unitRate constant. Optional
    here and enforced per row in superRefine, so an unchecked row is never
    asked for a price. Zero is valid and meaningful -- FR2.12 calls out
    the free handyman service.
  */
  basePrice: z.coerce
    .number()
    .min(0, "Base price cannot be negative")
    .max(10_000_000, "Base price can be at most 10,000,000")
    .optional(),
  /*
    Included at no charge (Jonathan, Oct 2026).

    Several services are free by their own wording -- the 24/7 hotline,
    the emergency call-out -- and the form still demanded a base price
    for each of them before it would submit. Typing 0 works, but it reads
    as "priced at nothing" rather than "not priced at all", and nobody
    guessed it. A free row needs no price, prices at 0, and says
    Included where the figure would be.

    Defaults from the service (`includedFree` in settings) and can be
    turned on or off per proposal, because what is thrown in free is a
    commercial decision taken one contract at a time.
  */
  free: z.boolean().default(false),
  price: z.coerce.number().min(0).optional(),
  /* From the rate card (BRD 5.3), shown read-only; the server sets them again. */
  rateItemId: z.string().nullable().optional(),
  standardRate: z.number().nullable().optional(),
  floorRate: z.number().nullable().optional(),
  promotionId: z.string().nullable().optional(),
  promotionPercent: z.number().nullable().optional(),
  belowFloor: z.boolean().optional(),
});

export const amcFormSchema = z
  .object({
    propertyCategory: propertyCategorySchema,
    /* The rate model (villa, apartment, office): what prices the proposal. */
    unitType: unitTypeSchema,
    /* BRD 5.2's full property type (Phase 4); optional for proposals saved before it. */
    propertyType: z.enum(UNIT_TYPES).optional(),
    propertyAddress: z.string().min(1, "Property address is required"),
    propertyDetail: z.string().min(1, "Property detail is required"),
    serviceRows: z.array(amcServiceRowSchema),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
    optionalSections: amcOptionalSectionsSchema,
    priceListRows: z.array(amcPriceListRowSchema),
    /*
      Clause 6.3's rates for this proposal (UAT AMC-057): asked for when the
      Additional fixed price services switch is on, starting from the rates
      in AMC Settings. Empty means the standard rates.
    */
    fixedPriceRates: z.array(z.string().max(300)).max(20),
    accountManagers: z.tuple([
      amcAccountManagerSchema,
      amcAccountManagerSchema,
    ]),
    customerName: z.string().min(1, "Client name is required"),
    /* FR4.4 / §8.2: prints in the contract header, where it used to
       fall back to "XXX". Required now. */
    customerId: z.string().min(1, "Customer ID is required"),
    customerPhone: z.string().min(1, "Client phone is required"),
    customerEmail: z.string().email("Invalid email address"),
    /* The first is required; the rest are optional, all or nothing (AMC-099). */
    coordinationContacts: z
      .array(optionalCoordinationContactSchema)
      .min(1, "Add the contact the team coordinates with")
      .max(MAX_COORDINATION_CONTACTS),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    paymentTerms: paymentTermsSchema,
    /* DEV-366: the payment plan; paymentTerms above is kept as its legacy reading. */
    paymentPlan: z.enum(PAYMENT_PLANS).optional(),
    paymentPlanCustom: customPlanSchema.nullable().optional(),
    /* Read from document_options; only the contract document prints it. */
    entitlementTerms: z.record(z.string(), amcEntitlementTermSchema).optional(),
    /* Allocated by the server on first save (step 1.7), so the user is
       never asked for it and cannot collide it. Empty until then. */
    proposalNumber: z.string(),
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
      // A free row is never asked for one; that is what free means.
      if (row.free) continue;
      if (row.basePrice === undefined || Number.isNaN(row.basePrice)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: BASE_PRICE_MESSAGE,
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

    if (
      data.optionalSections.additionalFixedPriceServices &&
      !data.fixedPriceRates.some((rate) => rate.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Enter at least one rate, or switch the additional fixed price services off",
        path: ["fixedPriceRates"],
      });
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

    /*
      The first contact is required in full. Every other one is all or
      nothing: a name with no number is worse than no contact at all, as
      it prints on the contract as somebody the engineer cannot reach.
    */
    data.coordinationContacts.forEach((contact, index) => {
      const first = index === 0;
      const issue = (field: "name" | "phone" | "designation", message: string) =>
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: ["coordinationContacts", index, field],
        });
      const hasName = Boolean(contact.name.trim());
      const hasPhone = Boolean(contact.phone.trim());
      if (first && !hasName) issue("name", "Name is required");
      if (first && !hasPhone) issue("phone", "Phone is required");
      if (!first && hasName && !hasPhone) issue("phone", "Add a number for this contact, or clear their name");
      if (!first && hasPhone && !hasName) issue("name", "Add a name for this contact, or clear their number");
      if ((first || hasName || hasPhone) && !contact.designation.trim()) {
        issue("designation", "Choose or type a designation");
      }
    });

    if (data.paymentPlan === "custom" && !data.paymentPlanCustom?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set the instalments of the custom payment plan",
        path: ["paymentPlanCustom"],
      });
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
export type OptionalCoordinationContact = z.infer<
  typeof optionalCoordinationContactSchema
>;
export type AmcServiceRow = z.infer<typeof amcServiceRowSchema>;
export type AmcOptionalSections = z.infer<typeof amcOptionalSectionsSchema>;
export type AmcPriceListRow = z.infer<typeof amcPriceListRowSchema>;
export type AmcAccountManager = z.infer<typeof amcAccountManagerSchema>;
export type AmcEntitlementTerm = z.infer<typeof amcEntitlementTermSchema>;
export type AmcFormData = z.infer<typeof amcFormSchema>;

export type AmcServiceFrequencyType =
  "covered" | "unlimited" | "ppm" | "handyman" | "fixed";

export type AmcDocumentType = "proposal" | "contract";

export interface AmcService {
  id: string;
  label: string;
  scope: string;
  reference: string;
  frequencyType: AmcServiceFrequencyType;
  /**
   * Included at no charge by default, so a new proposal never asks for a
   * base price for it (point 9: the 24/7 hotline has no unit rate and is
   * in every contract). Still a per-proposal choice -- this only decides
   * where the row starts.
   */
  includedFree?: boolean;
  /* The default the table starts at (FR2.3). No unitRate any more: price
     comes from the base price entered per proposal (FR2.4). */
  frequencyPerYear?: number;
  villaOnly: boolean;
  sectionNumber?: string;
  sectionTitle?: string;
  hasScopeSection: boolean;
}

export interface FrequencyRow {
  /** Which service the row is, so the contract can renumber its scope. */
  serviceId: string;
  scope: string;
  /* FR4.1 — "each with the units, frequency and price entered". */
  units: number;
  /**
   * Whether a unit count means anything for this service (Behrouz, Oct
   * 2026: "units only where they apply, such as AC").
   *
   * Every row printed a number, so the 24/7 hotline and the emergency
   * call-out read "1 Unit" — which says the client gets one call. True
   * for the services that are performed on a countable thing, which is
   * the same set that prints a scope of work of its own.
   */
  hasUnits: boolean;
  frequency: string;
  price: number;
  reference: string;
}

export interface AmcTotals {
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  /** How many whole months the contract runs, from its own dates. */
  termMonths: number;
  monthlyPrice: number;
  annualSubtotal: number;
  vatAmount: number;
  grandTotal: number;
  amountInWords: string;
}

export interface AmcComputedData {
  documentType: AmcDocumentType;
  /*
    FR6.4 — the text this document renders with. For a sent proposal this
    is its frozen snapshot; for a draft it is live settings. Defaulted by
    computeAmcData so a caller that has not loaded settings still renders
    the shipped text rather than nothing.
  */
  settings: AmcSettings;
  documentTitle: string;
  propertyTypeLabel: string;
  proposalDate: string;
  endDate: string;
  totals: AmcTotals;
  frequencyRows: FrequencyRow[];
  formData: AmcFormData;
}

/*
  §9.2 — the full status set. 'generated' is gone: it meant "a PDF was
  produced from this", which v2's workflow does not care about, and the
  phase 4 migration maps the one row carrying it back to draft.
*/
export const AMC_STATUSES = [
  "draft",
  "awaiting_approval",
  "sent_back",
  "approved",
  "proposal_sent",
  "proposal_rejected",
  "proposal_approved",
  "contract_sent",
  "signed",
] as const;

export type AmcSubmissionStatus = (typeof AMC_STATUSES)[number];

/* FR5.8 — how each status reads to a person. */
export const AMC_STATUS_LABELS: Record<AmcSubmissionStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  sent_back: "Sent back",
  approved: "Approved",
  proposal_sent: "Proposal sent",
  proposal_rejected: "Proposal rejected",
  proposal_approved: "Proposal approved",
  contract_sent: "Contract sent",
  signed: "Signed",
};

/*
  FR3.4 — "The owner can edit and resubmit while it is a draft or has been
  sent back. Once it is sent for review it is locked."
*/
/*
  Editable while it is with its owner: a draft, one the approver sent back,
  or one the client asked to change. The last two go back through internal
  approval before anything reaches the client again.
*/
/*
  BRD 5.4 (DEV-367): once the client has seen a proposal, a change is a new
  version, so a rejected proposal is revised (V2 opens as a draft) rather
  than edited in place.
*/
export function isAmcSubmissionEditable(status: AmcSubmissionStatus): boolean {
  return status === "draft" || status === "sent_back";
}

export interface AmcSubmissionProperty {
  propertyCategory: PropertyCategory;
  unitType: UnitType;
  propertyAddress: string;
  propertyDetail: string;
  /* Phase 4: the full property type; absent on older proposals. */
  propertyType?: (typeof UNIT_TYPES)[number];
}

export interface AmcSubmissionDocumentOptions {
  optionalSections: AmcOptionalSections;
  priceListRows: AmcPriceListRow[];
  /* Clause 6.3's rates for this proposal; absent on older ones (AMC-057). */
  fixedPriceRates?: string[];
  accountManagers: [AmcAccountManager, AmcAccountManager];
  /* Mirrored from the contract's entitlements (server side) for the contract document. */
  entitlementTerms?: Record<string, AmcEntitlementTerm>;
}

export interface AmcSubmissionCustomer {
  customerName: string;
  customerId?: string;
  customerPhone: string;
  customerEmail: string;
  /* The first is required, the rest optional (AMC-099). */
  coordinationContacts: OptionalCoordinationContact[];
  startDate: string;
  endDate: string;
  paymentTerms: PaymentTerms;
  proposalNumber: string;
}

/* Omit rather than extend: the form's basePrice is number | undefined
   (not yet typed), while the persisted one is number | null (not entered).
   Same idea, different absent-value convention -- JSON has no undefined. */
export interface AmcSubmissionServiceRow extends Omit<
  AmcServiceRow,
  "basePrice"
> {
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
  /*
    Absent on a row that came from the LIST, which does not carry the
    document's own content. The preview, the download and the email fetch
    the proposal itself before they read this.
  */
  document_options?: AmcSubmissionDocumentOptions;
  services: AmcSubmissionServiceRow[];
  discount_percent: number;
  discount_amount: number;
  final_price: number;
  generated_documents: AmcDocumentType[];
  /* FR6.4: frozen at send. Null while the submission is still a draft. */
  settings_snapshot?: AmcSettings | null;
  /* FR6.4: the contract's own copy, taken when the contract is sent. */
  contract_settings_snapshot?: AmcSettings | null;
  /* FR5.1–FR5.2, FR5.9 */
  submitted_at?: string | null;
  decided_at?: string | null;
  sent_back_reason?: string | null;
  /* FR5.4 — when each document went to the client. The date printed on a
     sent document is this one, not the day it happens to be viewed. */
  proposal_sent_at?: string | null;
  contract_sent_at?: string | null;
  /* FR5.5 / FR5.7 — the client answer on the link, and the signature. */
  client_decision?: "approved" | "rejected" | null;
  client_decided_at?: string | null;
  client_decided_by_name?: string | null;
  client_rejected_reason?: string | null;
  signed_by_name?: string | null;
  signed_at?: string | null;
  created_at: string;
  updated_at: string;
  /* Set on list rows. An approver also sees other people's submissions,
     so the list has to say whose each one is. */
  owner_name?: string | null;
  is_own?: boolean;
  /*
    Sent with a single submission (GET ?id=): whether the person reading it
    may approve or send it back. The detail page needs it, and it used to
    come only with the whole list.
  */
  viewer_can_approve?: boolean;
  /* The operational contract made from this proposal (Active AMC), on the
     single-proposal read only. null: none yet; absent: not checked or the
     contracts table does not exist yet. */
  contract_id?: string | null;
  /* Phase 4 (20261007140000). */
  property_type?: string | null;
  payment_plan?: PaymentPlan | null;
  payment_plan_custom?: CustomPlan | null;
  valid_until?: string | null;
  /* V1, V2, … (the row is always the active version). */
  current_version?: number;
  version_reason?: VersionReason | null;
  version_summary?: string | null;
  version_started_at?: string | null;
  enquiry_id?: string | null;
  below_floor?: boolean;
  rate_card_version_id?: string | null;
  /* Ticked lines the rate card cannot price as they stand (on save replies). */
  rate_problems?: string[];
}

/* One entry in a submission's history, from the audit trail (FR5.9). */
export interface AmcHistoryEvent {
  type: string;
  at: string;
  actor: string | null;
  origin: "portal" | "client" | "system";
  /* A send-back or client rejection reason. */
  note: string | null;
  payload: Record<string, unknown> | null;
}

/* One submission waiting for the caller's approval, for the header bell. */
export interface AmcPendingApproval {
  id: string;
  customerName: string;
  proposalNumber: string;
  ownerName: string;
  finalPrice: number;
  submittedAt: string | null;
}

export interface AmcPendingApprovalsResponse {
  canApprove: boolean;
  items: AmcPendingApproval[];
}

/* What it takes to rebuild a document. The dashboard passes a whole
   submission; the client page (FR5.5, FR5.7) has only these fields. */
export type AmcDocumentSource = Pick<
  AmcSubmission,
  "property" | "customer" | "document_options" | "services" | "discount_percent" | "payment_plan" | "payment_plan_custom"
> & { id?: string };

export interface AmcSubmissionListResponse {
  /* One page of the list, newest first. */
  submissions: AmcSubmission[];
  /* Every proposal matching the filters and search, across all pages. */
  totalCount: number;
  /* FR3.2 — set when the caller holds amc/approve, so the list can show
     the review queue as well as their own submissions. */
  canApprove?: boolean;
}
