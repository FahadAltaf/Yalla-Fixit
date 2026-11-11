/**
 * What a signed AMC promises the customer about support and response,
 * read from the wording frozen with the contract, never from today's AMC
 * Settings. No imports: usable from routes, components and tests.
 *
 * Response targets are shown as signed and never as "met": the portal does
 * not receive FSM request or arrival times, so compliance is UNKNOWN until
 * it does (lib/amc/sla.ts).
 *
 * BRD v0.3 (5.13) settles it at 48 hours, as the contract says; the old
 * brochure said non-emergency visits are scheduled within 6 hours. A
 * signed contract still shows the wording it was signed with: this module
 * reports what the signed wording says and never rewrites it.
 */

export interface SignedCommitments {
  /** As printed, e.g. "Within 120 minutes"; null when the snapshot has none. */
  emergencyResponse: string | null;
  standardResponse: string | null;
  /** The provider contact number printed on the contract. */
  supportContact: string | null;
  /** Whether the 24/7 technical support line is one of the contracted services. */
  helpdeskIncluded: boolean;
  /** Whether the commitments come from the contract's frozen wording. */
  fromSnapshot: boolean;
  compliance: "unknown";
}

type SnapshotLike = {
  provider?: {
    emergencyResponseTime?: unknown;
    standardResponseTime?: unknown;
    contactNo?: unknown;
  } | null;
} | null | undefined;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A placeholder left in the settings (e.g. "05X XXX XX") is not a contact. */
export function looksLikePlaceholderContact(value: string | null): boolean {
  return !!value && /X{2,}/i.test(value);
}

export function signedCommitments(
  snapshot: SnapshotLike,
  serviceIds: ReadonlyArray<string>,
): SignedCommitments {
  const provider = snapshot?.provider ?? null;
  return {
    emergencyResponse: text(provider?.emergencyResponseTime),
    standardResponse: text(provider?.standardResponseTime),
    supportContact: text(provider?.contactNo),
    helpdeskIncluded: serviceIds.includes("helpdesk"),
    fromSnapshot: !!provider,
    compliance: "unknown",
  };
}
