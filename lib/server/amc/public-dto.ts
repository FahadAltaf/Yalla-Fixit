import { z } from "zod";

import type { AmcSettings } from "@/components/dashboard/extensions/amc/amc-settings";

/**
 * What the client's link (app/api/amc/[token]) may return, built field by
 * field. Nothing internal is spread through: not the owner, not the audit,
 * not the token columns, not the approver list from AMC Settings.
 *
 * A link is OPEN only while its document is waiting for the client:
 *   proposal link -> status proposal_sent
 *   contract link -> status contract_sent
 * At any other status it is CLOSED (answered, signed, superseded by a
 * later stage, or being revised after the client asked for changes). A
 * closed link still says what happened, so the client sees "thank you"
 * rather than an error, but it carries no document and no customer data.
 * A link replaced by a newer send no longer matches any row and is a 404;
 * an expired one is a 410.
 */

export type LinkKind = "proposal" | "contract";

export function isLinkOpen(kind: LinkKind, status: string): boolean {
  return kind === "contract" ? status === "contract_sent" : status === "proposal_sent";
}

export type PublicRow = Record<string, unknown> & { status: string };

export interface PublicStatus {
  kind: LinkKind;
  status: string;
  /** True when the link no longer accepts an answer (see above). */
  closed: boolean;
  proposalNumber: string | null;
  customerName: string | null;
  startDate: string | null;
  endDate: string | null;
  paymentTerms: string | null;
  property: { propertyAddress?: string } | null;
  finalPrice: number;
  signedByName: string | null;
  signedAt: string | null;
}

export function toPublicStatus(row: PublicRow, kind: LinkKind): PublicStatus {
  const open = isLinkOpen(kind, row.status);
  const customer = (row.customer ?? {}) as Record<string, unknown>;
  const property = (row.property ?? null) as { propertyAddress?: unknown } | null;
  const signed = kind === "contract" && row.status === "signed";
  const str = (value: unknown) => (typeof value === "string" ? value : null);

  return {
    kind,
    status: row.status,
    closed: !open,
    proposalNumber: str(row.proposal_number),
    customerName: open ? str(customer.customerName) : null,
    startDate: open ? str(customer.startDate) : null,
    endDate: open ? str(customer.endDate) : null,
    paymentTerms: open ? str(customer.paymentTerms) : null,
    property:
      open && property
        ? { propertyAddress: str(property.propertyAddress) ?? undefined }
        : null,
    finalPrice: open ? Number(row.final_price ?? 0) : 0,
    /* The signer sees their own signature recorded, nothing else. */
    signedByName: signed ? str(row.signed_by_name) : null,
    signedAt: signed ? str(row.signed_at) : null,
  };
}

/**
 * The settings the client's renderer needs for THIS document, and no more:
 *   - provider details, clause wording and brochure copy that print;
 *   - only the clauses that are switched on (a disabled clause's text is
 *     blanked rather than sent);
 *   - only the services on this proposal, and only their scopes;
 *   - an empty approver list (the renderer's type has the field; the
 *     internal emails stay on the server).
 */
export function toPublicSettings(
  settings: AmcSettings,
  includedServiceIds: ReadonlyArray<string>,
): AmcSettings {
  const included = new Set(includedServiceIds);
  const enabledClauses = settings.clauseList.filter((clause) => clause.enabled !== false);
  const disabledRoles = new Set(
    settings.clauseList
      .filter((clause) => clause.enabled === false && clause.role)
      .map((clause) => clause.role as string),
  );
  const clauses = Object.fromEntries(
    Object.entries(settings.clauses).map(([role, body]) => [
      role,
      disabledRoles.has(role) ? "" : body,
    ]),
  ) as AmcSettings["clauses"];

  return {
    provider: { ...settings.provider },
    clauses,
    clauseList: enabledClauses.map((clause) => ({ ...clause })),
    services: settings.services
      .filter((service) => included.has(service.id))
      .map((service) => ({ ...service })),
    serviceScopes: Object.fromEntries(
      Object.entries(settings.serviceScopes).filter(([id]) => included.has(id)),
    ),
    brochure: { ...settings.brochure },
    approval: { approvers: [] },
  };
}

/* ------------------------------------------------------------------ */
/* The client's answer                                                 */
/* ------------------------------------------------------------------ */

/** Upper bound for the whole decision body. */
export const MAX_DECISION_BODY_BYTES = 16 * 1024;
export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const REASON_MIN = 3;
export const REASON_MAX = 2000;

/* Collapses runs of whitespace and strips control characters, so a name
   recorded as a signature is one readable line. */
const cleanName = z
  .string()
  .transform((value) =>
    value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim(),
  )
  .pipe(
    z
      .string()
      .min(NAME_MIN, "Please enter your full name")
      .max(NAME_MAX, `Please keep your name under ${NAME_MAX} characters`),
  );

const cleanReason = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim())
  .pipe(
    z
      .string()
      .min(REASON_MIN, "Please tell us what needs changing")
      .max(REASON_MAX, `Please keep this under ${REASON_MAX} characters`),
  );

export const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), name: cleanName }).strict(),
  z.object({ action: z.literal("reject"), name: cleanName, reason: cleanReason }).strict(),
  z.object({ action: z.literal("sign"), name: cleanName }).strict(),
]);

export type Decision = z.infer<typeof decisionSchema>;
