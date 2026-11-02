// Field validation for the compliance record (FRD FR-2). Shared by the API
// routes, the form and the import script, so a rule lives in one place.

import { z } from "zod";
import { EMPLOYMENT_STATUSES } from "./statuses";
import { normaliseEmiratesId } from "./masking";

export const DATE_MIN = "1950-01-01";
export const DATE_MAX = "2100-12-31";
export const REMARKS_MAX = 10_000;
export const EMIRATES_ID_PREFIX = "784";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in the allowed range, as YYYY-MM-DD. Rejects 1900-01-00 and 2026-02-30. */
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  return value >= DATE_MIN && value <= DATE_MAX;
}

export const dateSchema = z
  .string()
  .trim()
  .refine(isRealDate, { message: `Enter a real date between ${DATE_MIN} and ${DATE_MAX}` });

/** Optional date: empty string and null both mean "no date". */
export const optionalDateSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  dateSchema.nullable(),
);

export const emiratesIdSchema = z.preprocess(
  (v) => (typeof v === "string" ? normaliseEmiratesId(v) : v),
  z.string().regex(/^\d{15}$/, { message: "Emirates ID must be 15 digits" }),
);

export const optionalEmiratesIdSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  emiratesIdSchema.nullable(),
);

/** Soft notice, not an error: the sheet has one number starting 786. */
export function emiratesIdNotice(digits: string | null | undefined): string | null {
  if (!digits) return null;
  return digits.startsWith(EMIRATES_ID_PREFIX) ? null : `Emirates ID numbers normally start with ${EMIRATES_ID_PREFIX}; check this one`;
}

export const passportSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5,20}$/, { message: "Passport number must be 5 to 20 letters or digits" });

export const optionalPassportSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  passportSchema.nullable(),
);

export const maherIdSchema = z.string().trim().min(1, { message: "Employee ID (Maher ID) is required" }).max(40);

export const employmentStatusSchema = z.enum(EMPLOYMENT_STATUSES);

export const certificateInputSchema = z.object({
  certificate_type_id: z.string().uuid(),
  held: z.boolean(),
  expiry_date: optionalDateSchema,
});

export const employeeInputSchema = z.object({
  maher_id: maherIdSchema,
  full_name: z.string().trim().min(1, { message: "Name is required" }).max(200),
  designation_id: z.string().uuid().nullable(),
  nationality_id: z.string().uuid().nullable(),
  date_of_joining: optionalDateSchema,
  employment_status: employmentStatusSchema,
  site_client_id: z.string().uuid().nullable(),
  site_property_id: z.string().uuid().nullable(),
  fsm_resource_id: z.string().trim().min(1).nullable(),
  remarks: z.string().max(REMARKS_MAX).nullable(),
  identity: z
    .object({
      emirates_id_number: optionalEmiratesIdSchema,
      emirates_id_expiry: optionalDateSchema,
      passport_number: optionalPassportSchema,
      passport_expiry: optionalDateSchema,
    })
    .partial(),
  certificates: z.array(certificateInputSchema),
});

export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type CertificateInput = z.infer<typeof certificateInputSchema>;

/**
 * Rules that need more than one field. Returns field-keyed messages; an
 * empty object means the input is clean.
 */
export function crossFieldErrors(input: EmployeeInput, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.date_of_joining && input.date_of_joining > today) {
    errors.date_of_joining = "Date of joining cannot be in the future";
  }
  if (input.site_property_id && !input.site_client_id) {
    errors.site_property_id = "Choose the client before the project location";
  }
  return errors;
}

/** FR-2: setting Held to No clears the expiry, whatever the form sent. */
export function normaliseCertificates(certs: CertificateInput[]): CertificateInput[] {
  return certs.map((c) => (c.held ? c : { ...c, expiry_date: null }));
}
