import { z } from "zod";

import { detectImageType } from "./photos";

/**
 * Client profile, property, asset, access rule, scope and document rules
 * (BRD v0.3 5.2, 5.9; Phase 2). Pure: used by routes, screens and tests.
 */

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export const CUSTOMER_TYPES = ["individual", "company"] as const;
export const LIFECYCLES = ["prospect", "client", "former"] as const;
export const LIFECYCLE_LABELS: Record<(typeof LIFECYCLES)[number], string> = { prospect: "Prospect", client: "Client", former: "Former client" };
export const PREFERRED_CHANNELS = ["whatsapp", "email", "call", "sms"] as const;
export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  call: "Call",
  sms: "SMS",
  meeting: "Meeting",
  site_visit: "Site visit",
  portal: "Portal",
  other: "Other",
};

export const CONTACT_ROLES = ["primary", "alternate", "accounts", "tenant", "owner", "signatory", "site", "other"] as const;
export const CONTACT_ROLE_LABELS: Record<(typeof CONTACT_ROLES)[number], string> = {
  primary: "Primary",
  alternate: "Alternate",
  accounts: "Accounts",
  tenant: "Tenant",
  owner: "Owner",
  signatory: "Signatory",
  site: "On site",
  other: "Other",
};

export const COMMUNICATION_CHANNELS = ["call", "whatsapp", "email", "sms", "meeting", "site_visit", "portal", "other"] as const;
export const COMMUNICATION_DIRECTIONS = ["outbound", "inbound", "internal"] as const;

/** BRD 5.2: villa, apartment, townhouse, restaurant, clinic, shop, office (+ warehouse, other). */
export const UNIT_TYPES = ["villa", "apartment", "townhouse", "restaurant", "clinic", "shop", "office", "warehouse", "other"] as const;
export const UNIT_TYPE_LABELS: Record<(typeof UNIT_TYPES)[number], string> = {
  villa: "Villa",
  apartment: "Apartment",
  townhouse: "Townhouse",
  restaurant: "Restaurant",
  clinic: "Clinic",
  shop: "Shop",
  office: "Office",
  warehouse: "Warehouse",
  other: "Other",
};
/** The category a unit type usually belongs to (the form suggests it). */
export const UNIT_TYPE_CATEGORY: Record<(typeof UNIT_TYPES)[number], "residential" | "commercial" | null> = {
  villa: "residential",
  apartment: "residential",
  townhouse: "residential",
  restaurant: "commercial",
  clinic: "commercial",
  shop: "commercial",
  office: "commercial",
  warehouse: "commercial",
  other: null,
};
export const OCCUPANCIES = ["owner", "tenant", "vacant"] as const;

/** BRD 5.2: AC, plumbing, electrical, handyman, civil. */
export const TRADES = ["ac", "plumbing", "electrical", "handyman", "civil", "other"] as const;
export const TRADE_LABELS: Record<(typeof TRADES)[number], string> = {
  ac: "AC",
  plumbing: "Plumbing",
  electrical: "Electrical",
  handyman: "Handyman",
  civil: "Civil",
  other: "Other",
};
/** Suggested asset types per trade; any other text is allowed. */
export const ASSET_TYPE_SUGGESTIONS: Record<(typeof TRADES)[number], string[]> = {
  ac: ["Split AC", "Ducted AC", "Package unit", "Fan coil unit", "Chiller", "Cassette AC", "Window AC"],
  plumbing: ["Water heater", "Water pump", "Water tank", "Booster pump", "Drainage"],
  electrical: ["Distribution board", "Generator", "Lighting", "Socket circuit"],
  handyman: ["Doors and locks", "Joinery", "Fixtures"],
  civil: ["Roof", "Walls", "Waterproofing", "Flooring"],
  other: [],
};
export const ASSET_CONDITIONS = ["good", "fair", "poor", "critical", "unknown"] as const;

/** BRD 5.9 access types. */
export const ACCESS_TYPES = ["community_gate_pass", "building_permit", "security_clearance", "lift_booking", "key_collection", "other"] as const;
export const ACCESS_TYPE_LABELS: Record<(typeof ACCESS_TYPES)[number], string> = {
  community_gate_pass: "Community gate pass",
  building_permit: "Building permit",
  security_clearance: "Security clearance",
  lift_booking: "Lift booking",
  key_collection: "Key collection",
  other: "Other",
};

export const DOCUMENT_LEVELS = ["customer", "property", "contract", "proposal", "enquiry", "visit", "call_out"] as const;
export type DocumentLevel = (typeof DOCUMENT_LEVELS)[number];
/** Categories offered per level (BRD 5.9); free text is not allowed so reports stay groupable. */
export const DOCUMENT_CATEGORIES: Record<DocumentLevel, string[]> = {
  customer: ["Trade licence", "Emirates ID / passport", "TRN certificate", "Correspondence", "Other"],
  property: ["Title deed", "Tenancy contract", "Floor plan", "Access pass", "Photos", "Other"],
  contract: ["Signed contract", "Signed scan", "Amendment", "Correspondence", "Other"],
  proposal: ["Proposal PDF", "Client decision evidence", "Other"],
  enquiry: ["Site visit photos", "Correspondence", "Other"],
  visit: ["Gate pass", "Job sheet", "Service report", "Photos", "Other"],
  call_out: ["Photos", "Quotation", "Other"],
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00");
const email = z.string().trim().email("Enter a valid email").max(200).nullable().optional().or(z.literal(""));

/** The identity part of a client (added to the existing customer form). */
export const customerProfileFields = {
  customerType: z.enum(CUSTOMER_TYPES).nullable().optional(),
  lifecycle: z.enum(LIFECYCLES).optional(),
  tradeLicenseNo: text(60),
  tradeLicenseExpiry: isoDate.nullable().optional(),
  trn: z
    .string()
    .trim()
    .regex(/^\d{15}$/, "A TRN has 15 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  preferredChannel: z.enum(PREFERRED_CHANNELS).nullable().optional(),
  preferredLanguage: text(40),
};

export const consentSchema = z
  .object({
    consent: z.boolean(),
    source: required(120, "Say how consent was given (e.g. signed form, WhatsApp reply)"),
  })
  .strict();

export const contactSchema = z
  .object({
    role: z.enum(CONTACT_ROLES),
    name: required(200, "Enter the contact's name"),
    position: text(120),
    phone: text(40),
    whatsapp: text(40),
    email,
    notes: text(1000),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !!(v.phone?.trim() || v.whatsapp?.trim() || v.email?.toString().trim()), {
    message: "Give at least a phone, WhatsApp number or email",
    path: ["phone"],
  });

export const communicationSchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    direction: z.enum(COMMUNICATION_DIRECTIONS),
    subject: text(200),
    summary: required(4000, "Write what was said or agreed"),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    propertyId: z.string().uuid().nullable().optional(),
    contractId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** The property fields added in Phase 2 (merged into the existing property form). */
export const propertyExtraFields = {
  unitType: z.enum(UNIT_TYPES).nullable().optional(),
  building: text(200),
  unitNo: text(60),
  floor: text(30),
  street: text(200),
  city: text(80),
  floorsCount: z.number().int().min(0).max(300).nullable().optional(),
  zones: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  occupancy: z.enum(OCCUPANCIES).nullable().optional(),
  accessConstraints: text(2000),
  parentPropertyId: z.string().uuid().nullable().optional(),
};

export const assetSchema = z
  .object({
    assetType: required(80, "Choose or type the asset type"),
    trade: z.enum(TRADES),
    quantity: z.number().int().min(1).max(1000),
    location: text(120),
    make: text(80),
    model: text(80),
    serialNo: text(80),
    capacity: text(60),
    installedOn: isoDate.nullable().optional(),
    condition: z.enum(ASSET_CONDITIONS),
    notes: text(1000),
  })
  .strict()
  .refine((v) => !v.serialNo?.trim() || v.quantity === 1, {
    message: "An asset with a serial number is one unit; add the others separately",
    path: ["quantity"],
  });

export const retireAssetSchema = z.object({ reason: required(300, "Say why the asset is retired") }).strict();

export const accessRuleSchema = z
  .object({
    accessType: z.enum(ACCESS_TYPES),
    issuer: text(200),
    leadTimeDays: z.number().int().min(0).max(90),
    permittedDays: z.array(z.number().int().min(0).max(6)).max(7),
    permittedFrom: hhmm.nullable().optional(),
    permittedTo: hhmm.nullable().optional(),
    parking: text(500),
    contactName: text(200),
    contactPhone: text(40),
    notes: text(2000),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !v.permittedFrom || !v.permittedTo || v.permittedFrom < v.permittedTo, {
    message: "The end time must be after the start time",
    path: ["permittedTo"],
  });

export const scopeItemSchema = z
  .object({
    serviceId: required(100, "Choose the service"),
    trade: z.enum(TRADES),
    assetId: z.string().uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(1000),
    frequencyPerYear: z.number().int().min(1).max(365).nullable().optional(),
    durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
    preferredMonths: z.array(z.number().int().min(1).max(12)).max(12),
    preferredDays: z.array(z.number().int().min(0).max(6)).max(7),
    exclusions: text(2000),
    notes: text(1000),
    active: z.boolean().optional(),
  })
  .strict();

export const documentMetaSchema = z
  .object({
    level: z.enum(DOCUMENT_LEVELS),
    entityId: z.string().uuid(),
    category: required(80, "Choose a category"),
    title: required(200, "Give the document a title"),
    expiresOn: isoDate.nullable().optional(),
    notes: text(1000),
  })
  .strict()
  .refine((v) => DOCUMENT_CATEGORIES[v.level].includes(v.category), { message: "Choose one of the listed categories", path: ["category"] });

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const AMC_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export type AmcDocumentType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The file's real type, from its first bytes, never from the name or the
 * browser's claim (an HTML or SVG file renamed .pdf is refused). Word and
 * Excel files are zip containers; the extension tells which.
 */
export function detectDocumentType(bytes: Uint8Array, fileName: string): AmcDocumentType | null {
  const image = detectImageType(bytes);
  if (image) return image;
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".docx")) return DOCX;
    if (lower.endsWith(".xlsx")) return XLSX;
  }
  return null;
}

export const DOCUMENT_EXTENSION: Record<AmcDocumentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  [DOCX]: "docx",
  [XLSX]: "xlsx",
} as Record<AmcDocumentType, string>;

/** The next version for the same document (same level, record, category and title). */
export function nextDocumentVersion(existingVersions: number[]): number {
  return existingVersions.length === 0 ? 1 : Math.max(...existingVersions) + 1;
}

/** Object key in the private bucket: never derived from the file name. */
export function documentStoragePath(level: DocumentLevel, entityId: string, documentId: string, type: AmcDocumentType): string {
  return `documents/${level}/${entityId}/${documentId}.${DOCUMENT_EXTENSION[type]}`;
}

/** "expired", "expiring" (within the days given) or null, for a document's expiry date. */
export function documentExpiryState(expiresOn: string | null, today: string, withinDays = 30): "expired" | "expiring" | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return "expired";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + withinDays);
  return expiresOn <= limit.toISOString().slice(0, 10) ? "expiring" : null;
}

/* ------------------------------------------------------------------ */
/* Combined units                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whether making `parentId` the parent of `propertyId` would create a loop
 * (A → B → A), given the current parent of each property.
 */
export function wouldCreateParentLoop(propertyId: string, parentId: string | null, parentOf: Map<string, string | null>): boolean {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === propertyId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}
