import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "@/lib/server/snagging/audit";

/**
 * Quotation decisioning (FR-2.06, FR-2.07). Shared by the internal
 * coordinator route and the public client-approval page so both record the
 * decision identically. A quotation can only be decided once — approve or
 * reject is refused if it is already approved or rejected.
 */
type Admin = SupabaseClient;

export type QuoteRef = { id: string; job_id: string; quote_number: string; status: string };

export class QuotationDecisionError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

function assertDecidable(quote: QuoteRef) {
  if (quote.status === "approved" || quote.status === "rejected") {
    throw new QuotationDecisionError("This quotation has already been decided.", 409);
  }
}

export async function approveQuotation(
  admin: Admin,
  quote: QuoteRef,
  opts: { name?: string | null; contact?: string | null; actorId?: string | null; origin: "portal" | "client" },
) {
  assertDecidable(quote);
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({
      status: "approved",
      approved_at: now,
      decided_at: now,
      approved_by_name: opts.name ?? null,
      approved_by_contact: opts.contact ?? null,
      updated_at: now,
    })
    .eq("id", quote.id)
    .in("status", ["draft", "sent"])
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // BR-2 / F6 / FR-2.07: an approved quote unlocks inspector assignment.
  const { error: jobError } = await admin
    .from("snagging_jobs")
    .update({ status: "assigned" })
    .eq("id", quote.job_id)
    .eq("status", "draft");
  if (jobError) throw new Error(jobError.message);

  await recordAudit(admin, {
    entityType: "task",
    entityId: quote.job_id,
    taskId: quote.job_id,
    eventType: "quotation_approved",
    actorId: opts.actorId ?? null,
    actorLabel: opts.origin === "client" ? (opts.name ?? "Client") : null,
    origin: opts.origin === "client" ? "system" : "portal",
    payload: { quote_number: quote.quote_number, by: opts.name ?? null, origin: opts.origin },
  });

  return data;
}

export async function rejectQuotation(
  admin: Admin,
  quote: QuoteRef,
  opts: {
    reason: string;
    name?: string | null;
    contact?: string | null;
    actorId?: string | null;
    origin: "portal" | "client";
  },
) {
  assertDecidable(quote);
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({
      status: "rejected",
      rejected_reason: opts.reason,
      decided_at: now,
      approved_by_name: opts.name ?? null,
      approved_by_contact: opts.contact ?? null,
      updated_at: now,
    })
    .eq("id", quote.id)
    .in("status", ["draft", "sent"])
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // The job stays a draft — inspector assignment remains blocked (FR-2.07).
  await recordAudit(admin, {
    entityType: "task",
    entityId: quote.job_id,
    taskId: quote.job_id,
    eventType: "quotation_rejected",
    actorId: opts.actorId ?? null,
    actorLabel: opts.origin === "client" ? (opts.name ?? "Client") : null,
    origin: opts.origin === "client" ? "system" : "portal",
    justification: opts.reason,
    payload: { quote_number: quote.quote_number, origin: opts.origin },
  });

  return data;
}
