import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * FR-9.04 — the quotation gate for an additional visit.
 *
 * An additional visit is chargeable work, so it may only be scheduled
 * once the client has approved a quotation FOR THAT VISIT. Enforced here,
 * server-side, because the charge is the point: booking one without an
 * approved quote commits an inspector to work nobody has agreed to pay
 * for, and a disabled button in the UI is not a control — anything that
 * can reach the API can bypass it.
 *
 * Deliberately not satisfied by the original inspection's quotation. That
 * quote paid for the original inspection; a return visit is separate work
 * with its own price, and reusing the parent's approval would let visit
 * two through on visit one's authorisation.
 */
export type QuotationGateResult =
  | { ok: true; quotationId: string; total: number | null }
  | { ok: false; reason: string };

type QuoteRow = {
  id: string;
  job_id: string;
  status: string;
  total: number | null;
  quote_number: string | null;
};

/**
 * Whether this visit may be scheduled.
 *
 * Every rejection names what is actually wrong, because "not allowed" to
 * a coordinator who has just watched the client approve something is
 * indistinguishable from a bug.
 */
export async function assertVisitQuotationApproved(
  admin: SupabaseClient,
  visitId: string,
): Promise<QuotationGateResult> {
  const { data, error } = await admin
    .from("snagging_quotations")
    .select("id, job_id, status, total, quote_number")
    .eq("job_id", visitId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const quotes = (data ?? []) as QuoteRow[];

  if (quotes.length === 0) {
    return {
      ok: false,
      reason:
        "This visit has no quotation yet. Create one for the visit, send it to the client, and schedule once they approve it.",
    };
  }

  const approved = quotes.find((q) => q.status === "approved");
  if (approved) {
    return { ok: true, quotationId: approved.id, total: approved.total };
  }

  // Nothing approved: say which state it is actually in, newest first.
  const latest = quotes[0];
  const named = latest.quote_number ? ` (${latest.quote_number})` : "";

  switch (latest.status) {
    case "draft":
      return {
        ok: false,
        reason: `The quotation for this visit${named} is still a draft. Send it to the client before scheduling.`,
      };
    case "sent":
      return {
        ok: false,
        reason: `The quotation for this visit${named} has been sent but the client has not approved it yet.`,
      };
    case "rejected":
      return {
        ok: false,
        reason: `The client rejected the quotation for this visit${named}. Raise a new one before scheduling.`,
      };
    default:
      return {
        ok: false,
        reason: `The quotation for this visit${named} is ${latest.status}, not approved.`,
      };
  }
}
