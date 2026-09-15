import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The quotation gate for a de-snagging round (BA v2, change 31 / FR-8.01).
 *
 * A de-snag used to be free: a "round two" of the original inspection,
 * opened whenever a reviewer decided it was due, at no charge. That is not
 * how the work is sold — the client is quoted for a return visit to verify
 * fixes and agrees a price for it — so a round may only be opened against
 * a quotation they have approved.
 *
 * Enforced server-side for the same reason the visit gate is: the charge
 * is the point. Opening one without an approved quotation commits an
 * inspector to a day's work nobody has agreed to pay for, and a disabled
 * button is not a control — anything that can reach the API bypasses it.
 *
 * Deliberately NOT satisfied by the original inspection's quotation. That
 * one paid for the first visit; a return is separate work with its own
 * price, and accepting the parent's approval would let every round through
 * on the strength of the first.
 */
type Admin = SupabaseClient;

export type DesnagGateResult =
  | { ok: true; quotationId: string; quoteNumber: string; total: number | null }
  | { ok: false; reason: string };

type QuoteRow = {
  id: string;
  status: string;
  total: number | null;
  quote_number: string | null;
  job_id: string | null;
};

/**
 * Whether a de-snag round may be opened against this job.
 *
 * `sourceJobId` is the ORIGINAL inspection — the job being returned to —
 * which is what a de-snag quotation names. Every rejection says which
 * state the quotation is actually in, because "not allowed" to a
 * coordinator who has just watched the client approve something is
 * indistinguishable from a bug.
 */
export async function assertDesnagQuotationApproved(
  admin: Admin,
  sourceJobId: string,
  quotationId?: string | null,
): Promise<DesnagGateResult> {
  let query = admin
    .from("snagging_quotations")
    .select("id, status, total, quote_number, job_id")
    .eq("source_job_id", sourceJobId)
    .eq("quote_kind", "desnag")
    .order("created_at", { ascending: false });

  if (quotationId) query = query.eq("id", quotationId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const quotes = (data ?? []) as QuoteRow[];

  if (quotes.length === 0) {
    return {
      ok: false,
      reason: quotationId
        ? "That de-snag quotation does not belong to this job."
        : "This job has no de-snag quotation yet. Raise one from Quotations, send it to the client, and open the round once they approve it.",
    };
  }

  /*
    An approved quotation already spent on a round cannot pay for a second
    one. `job_id` is filled in when the round is created, so a quotation
    still carrying null is the one that has not been used.
  */
  const usable = quotes.find((q) => q.status === "approved" && !q.job_id);
  if (usable) {
    return {
      ok: true,
      quotationId: usable.id,
      quoteNumber: usable.quote_number ?? "",
      total: usable.total,
    };
  }

  const spent = quotes.find((q) => q.status === "approved" && q.job_id);
  if (spent) {
    return {
      ok: false,
      reason: `De-snag quotation ${spent.quote_number ?? ""} has already been used to open a round. Raise a new one for another visit.`.replace(
        /\s+/g,
        " ",
      ),
    };
  }

  const latest = quotes[0];
  const named = latest.quote_number ? ` (${latest.quote_number})` : "";
  switch (latest.status) {
    case "draft":
      return {
        ok: false,
        reason: `The de-snag quotation${named} is still a draft. Send it to the client before opening the round.`,
      };
    case "sent":
      return {
        ok: false,
        reason: `The de-snag quotation${named} has been sent but the client has not approved it yet.`,
      };
    case "rejected":
      return {
        ok: false,
        reason: `The client rejected the de-snag quotation${named}. Raise a new one before opening a round.`,
      };
    default:
      return {
        ok: false,
        reason: `The de-snag quotation${named} is ${latest.status}, not approved.`,
      };
  }
}
