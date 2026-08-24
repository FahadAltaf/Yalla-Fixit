import { z } from "zod";

/**
 * Validation for the snagging module.
 *
 * These schemas are the single definition of what a valid payload is:
 * the API routes parse request bodies with them and the dashboard forms
 * resolve against the same objects, so a rule added here cannot be
 * enforced on only one side.
 */

export const severitySchema = z.enum(["low", "medium", "high"]);

export const propertyTypeSchema = z.enum([
  "apartment",
  "villa",
  "townhouse",
  "commercial",
]);

export const serviceTierSchema = z.enum(["essential", "comfort", "full", "b2b_building"]);

export const taskTypeSchema = z.enum(["single_unit", "full_building"]);

export const rejectionCategorySchema = z.enum(["minor", "data_correction", "critical"]);

export const snagStatusSchema = z.enum([
  "open",
  "pending_verification",
  "verified_closed",
  "verified_poor_quality",
  "verified_not_done",
  "withdrawn",
]);

export const verdictSchema = z.enum([
  "verified_closed",
  "verified_poor_quality",
  "verified_not_done",
  "withdrawn",
]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const isoDateTime = z.string().datetime({ offset: true });

/** BR-1: a task is always anchored to a client and a property record. */
export const propertyInputSchema = z.object({
  // Client (D1: name required, phone required and international, email optional).
  client_name: z.string().trim().min(2, "Client name is required"),
  client_email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  client_phone: z.string().trim().max(32).optional().or(z.literal("")),
  // Property location.
  unit_label: z.string().trim().min(1, "Unit is required"),
  building_name: z.string().trim().optional().or(z.literal("")),
  community: z.string().trim().optional().or(z.literal("")),
  city: z.string().trim().optional().or(z.literal("")),
  property_type: propertyTypeSchema,
  developer_name: z.string().trim().optional().or(z.literal("")),
  // Measurements (E2-E6). Bedrooms: 0 = studio, hidden for commercial.
  bedrooms: z.coerce.number().int().min(0).max(11).optional().nullable(),
  built_up_area_sqft: z.coerce.number().positive("Built up area is required").optional().nullable(),
  plot_area_sqft: z.coerce.number().positive().optional().nullable(),
  external_areas_in_scope: z.coerce.boolean().optional(),
  floors: z.coerce.number().int().min(1).max(20).optional().nullable(),
  // Location pin (E7) and documents (E8/E10).
  location_lat: z.coerce.number().optional().nullable(),
  location_lng: z.coerce.number().optional().nullable(),
  title_deed_path: z.string().trim().optional().or(z.literal("")),
  noc_required: z.coerce.boolean().optional(),
  noc_path: z.string().trim().optional().or(z.literal("")),
});

/** A standalone property record (BR-1) — client + property attributes, no client detail. */
export const propertyUpsertSchema = z.object({
  client_id: z.string().uuid(),
  unit_label: z.string().trim().min(1, "Unit is required"),
  building_name: z.string().trim().optional().or(z.literal("")),
  community: z.string().trim().optional().or(z.literal("")),
  property_type: propertyTypeSchema,
  developer_name: z.string().trim().optional().or(z.literal("")),
  bedrooms: z.coerce.number().int().min(0).max(11).optional().nullable(),
  built_up_area_sqft: z.coerce.number().positive().optional().nullable(),
  plot_area_sqft: z.coerce.number().positive().optional().nullable(),
  external_areas_in_scope: z.coerce.boolean().optional(),
  floors: z.coerce.number().int().min(1).max(20).optional().nullable(),
  location_lat: z.coerce.number().optional().nullable(),
  location_lng: z.coerce.number().optional().nullable(),
  title_deed_path: z.string().trim().optional().or(z.literal("")),
  noc_required: z.coerce.boolean().optional(),
  noc_path: z.string().trim().optional().or(z.literal("")),
});

export const createTaskSchema = z
  .object({
    // An already-persisted client (from the picker / add-client dialog).
    client_id: z.string().uuid().optional(),
    // Either an existing property, or the details to create one.
    property_id: z.string().uuid().optional(),
    property: propertyInputSchema.optional(),

    // Job type is gone from this step (E9): full building is a separate flow.
    scheduled_date: isoDate.optional().or(z.literal("")),
    // Appointment date + time (I2), and the two site contacts (I3, I4).
    appointment_at: isoDateTime.optional().or(z.literal("")),
    developer_contact_name: z.string().trim().max(120).optional().or(z.literal("")),
    developer_contact_phone: z.string().trim().max(32).optional().or(z.literal("")),
    client_contact_name: z.string().trim().max(120).optional().or(z.literal("")),
    client_contact_phone: z.string().trim().max(32).optional().or(z.literal("")),

    // FR-1.04
    technician_ids: z.array(z.string().uuid()).default([]),
    supervisor_id: z.string().uuid().optional().nullable(),
    approval_manager_id: z.string().uuid().optional().nullable(),

    // FR-1.03: which template seeds the area list. Defaults to the
    // property type's template when omitted.
    area_template_property_type: propertyTypeSchema.optional(),
    areas: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          catalogue_area_code: z.string().trim().min(1).optional(),
        }),
      )
      .optional(),

    notes: z.string().trim().max(4000).optional().or(z.literal("")),
  })
  .refine((value) => Boolean(value.client_id || value.property), {
    message: "Select an existing client or provide client and property details",
    path: ["client_id"],
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  scheduled_date: isoDate.optional().nullable(),
  scheduled_start_at: isoDateTime.optional().nullable(),
  scheduled_end_at: isoDateTime.optional().nullable(),
  technician_ids: z.array(z.string().uuid()).optional(),
  supervisor_id: z.string().uuid().optional().nullable(),
  approval_manager_id: z.string().uuid().optional().nullable(),
  package_name: z.string().trim().max(120).optional().nullable(),
  service_tier: serviceTierSchema.optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["draft", "assigned", "cancelled"]).optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** BR-4/BR-5: approval carries no free pass, rejection carries a reason. */
export const approveTaskSchema = z.object({
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const rejectTaskSchema = z.object({
  category: rejectionCategorySchema,
  comment: z
    .string()
    .trim()
    .min(10, "Give the inspector at least a sentence explaining what to fix"),
});

export type RejectTaskInput = z.infer<typeof rejectTaskSchema>;

export const catalogueEntrySchema = z.object({
  element_code: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, "Element code is two capital letters, e.g. WL"),
  element_label: z.string().trim().min(2),
  defect_code: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Defect code is three capital letters, e.g. CRK"),
  defect_label: z.string().trim().min(2),
  default_severity: severitySchema,
  guidance: z.string().trim().max(1000).optional().or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).default(0),
});

export type CatalogueEntryInput = z.infer<typeof catalogueEntrySchema>;

/** BR-8: entries are deactivated, never deleted. */
export const catalogueToggleSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export const createRoundSchema = z.object({
  scheduled_date: isoDate.optional().or(z.literal("")),
  technician_ids: z.array(z.string().uuid()).default([]),
  approval_manager_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  // Which outstanding snags to carry into the round. Omit to carry
  // every outstanding snag on the property (the default the server
  // applies when the reviewer does not narrow the list).
  snag_ids: z.array(z.string().uuid()).optional(),
});

/**
 * Schedules an additional (chargeable) snagging visit on a property
 * (Q1-Q6). Unlike a de-snag round it carries no snags forward — it is a
 * fresh inspection pass — so there is no snag_ids field.
 */
export const createVisitSchema = z.object({
  scheduled_date: isoDate.optional().or(z.literal("")),
  technician_ids: z.array(z.string().uuid()).default([]),
  approval_manager_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  reason: z.string().trim().max(4000).optional().or(z.literal("")),
});

export const deliverReportSchema = z.object({
  channel: z.enum(["email", "whatsapp", "manual"]).default("email"),
  recipient: z.string().trim().min(3, "Recipient is required"),
  expires_in_days: z.coerce.number().int().min(1).max(90).default(30),
});

// -----------------------------------------------------
// Mobile sync contract (§6.3)
// -----------------------------------------------------

/**
 * One row from the device outbox. `mutation_id` is the idempotency key:
 * the server applies a given id at most once, so a retry after a
 * dropped response can never double-insert a snag.
 */
export const syncMutationSchema = z.object({
  mutation_id: z.string().uuid(),
  entity: z.enum(["snag", "area", "photo", "verification", "submission", "task", "checklist"]),
  entity_id: z.string().uuid(),
  op: z.enum(["insert", "update", "delete"]),
  payload: z.record(z.string(), z.unknown()),
  created_at: isoDateTime.optional(),
});

export const syncPushSchema = z.object({
  device_id: z.string().trim().max(128).optional(),
  app_version: z.string().trim().max(32).optional(),
  free_bytes: z.coerce.number().int().nonnegative().optional(),
  // Batched so a long offline stretch drains in a bounded number of
  // round trips rather than one request per snag.
  mutations: z.array(syncMutationSchema).max(500),
});

export type SyncPushInput = z.infer<typeof syncPushSchema>;

export const syncPullSchema = z.object({
  /** Server timestamp from the previous pull; omit for a cold start. */
  since: isoDateTime.optional(),
  task_ids: z.array(z.string().uuid()).optional(),
  include_catalogue: z.coerce.boolean().optional(),
});

export const mediaSignSchema = z.object({
  task_id: z.string().uuid(),
  snag_id: z.string().uuid().optional(),
  /** Client-side id; becomes the object key so retries overwrite. */
  media_id: z.string().uuid(),
  content_type: z.string().trim().min(3).max(100),
  kind: z.enum(["snag_photo", "snag_video", "signature", "floor_plan"]).default("snag_photo"),
});
