import type { SupabaseClient } from "@supabase/supabase-js";

import { emailService } from "@/lib/email-service";
import { hasColumn } from "@/lib/server/snagging/columns";

/**
 * A quotation made void because the property is not as quoted (UAT SNG-100).
 *
 * The inspector flags on site that the unit's furnishing differs from what
 * the quotation was priced on. The quotation the job stands on is then
 * void: the office is emailed, the job and the quotation say so, and the
 * inspection cannot be approved until a revised quotation (raised from the
 * job, priced as found) has been approved by the client. The inspector
 * carries on meanwhile; they are already on site.
 *
 * Needs migration 20261020100000; until it is applied nothing here writes
 * and the job reads as not void.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export const VOID_COLUMNS = "voided_at, void_reason, voided_by, replaced_by_quotation_id";

export function voidColumnsReady(admin: Admin): Promise<boolean> {
  return hasColumn(admin, "snagging_quotations", "voided_at");
}

export interface JobVoidState {
  /** The quotation that is void. */
  quotation: { id: string; quote_number: string; voided_at: string; void_reason: string | null };
  /** The revised quotation raised for it, once there is one. */
  revised: { id: string; quote_number: string; status: string } | null;
  /** True until the revised quotation is approved: the job cannot be approved meanwhile. */
  blocking: boolean;
}

/** The job's void quotation and where its revision stands; null when nothing on the job is void. */
export async function jobVoidState(admin: Admin, jobId: string): Promise<JobVoidState | null> {
  if (!(await voidColumnsReady(admin))) return null;
  const { data, error } = await admin
    .from("snagging_quotations")
    .select(`id, quote_number, status, created_at, ${VOID_COLUMNS}`)
    .eq("job_id", jobId)
    .neq("quote_kind", "visit")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const voided = rows.find((row) => row.voided_at);
  if (!voided) return null;
  /* The one it was replaced by, else the newest quotation raised after it that is not void itself. */
  const revised =
    rows.find((row) => row.id === voided.replaced_by_quotation_id) ??
    rows.find((row) => !row.voided_at && String(row.created_at) > String(voided.created_at)) ??
    null;
  return {
    quotation: {
      id: String(voided.id),
      quote_number: String(voided.quote_number ?? ""),
      voided_at: String(voided.voided_at),
      void_reason: (voided.void_reason as string | null) ?? null,
    },
    revised: revised
      ? { id: String(revised.id), quote_number: String(revised.quote_number ?? ""), status: String(revised.status) }
      : null,
    blocking: !(revised && revised.status === "approved" && !revised.voided_at),
  };
}

const describe = (furnished: boolean) => (furnished ? "furnished" : "unfurnished");

/**
 * The inspector's furnishing report, from the app. When it differs from
 * the quotation the job stands on, that quotation becomes void. Nothing
 * changes when it matches, when the job has no quotation of its own, or
 * when the quotation is already void.
 */
export async function voidForFurnishing(
  admin: Admin,
  input: { jobId: string; found: boolean; note: string | null; actorId: string },
): Promise<{ voided: boolean; quotation?: { id: string; quote_number: string; created_by: string | null }; reason?: string }> {
  if (!(await voidColumnsReady(admin))) return { voided: false };
  const { data, error } = await admin
    .from("snagging_quotations")
    .select(`id, quote_number, status, furnished, created_by, ${VOID_COLUMNS}`)
    .eq("job_id", input.jobId)
    .eq("quote_kind", "inspection")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const quote = data as Row | null;
  if (!quote || quote.voided_at) return { voided: false };
  const quoted = Boolean(quote.furnished);
  if (quoted === input.found) return { voided: false };

  const note = input.note?.trim();
  const reason = `Quoted ${describe(quoted)}; the inspector found the unit ${describe(input.found)}.${note ? ` ${note}` : ""}`;
  const { data: updated, error: updateError } = await admin
    .from("snagging_quotations")
    .update({ voided_at: new Date().toISOString(), void_reason: reason, voided_by: input.actorId })
    .eq("id", String(quote.id))
    .is("voided_at", null)
    .select("id");
  if (updateError) throw new Error(updateError.message);
  if (!updated?.length) return { voided: false };
  return {
    voided: true,
    reason,
    quotation: { id: String(quote.id), quote_number: String(quote.quote_number ?? ""), created_by: (quote.created_by as string | null) ?? null },
  };
}

/**
 * Tells the office: the quotation's coordinator, the job's approval
 * manager and whoever raised the job. Best effort: a failed email never
 * undoes the flag, which the job page and the attention card show anyway.
 */
export async function emailQuotationVoid(
  admin: Admin,
  input: { jobId: string; quotationNumber: string; quotationCreatedBy: string | null; reason: string; inspectorName: string | null },
): Promise<void> {
  try {
    const { data: job } = await admin
      .from("snagging_jobs")
      .select("id, code, unit_label, building_name, approval_manager_id, created_by")
      .eq("id", input.jobId)
      .maybeSingle();
    const row = job as Row | null;
    if (!row) return;
    const ids = [...new Set([input.quotationCreatedBy, row.approval_manager_id, row.created_by].filter(Boolean) as string[])];
    if (!ids.length) return;
    const { data: people } = await admin.from("user_profile").select("email").in("id", ids);
    const to = [...new Set(((people ?? []) as Row[]).map((p) => String(p.email ?? "").trim()).filter(Boolean))];
    if (!to.length) return;
    await emailService.sendSnaggingQuotationVoidEmail({
      to,
      code: String(row.code ?? ""),
      unit: [row.unit_label, row.building_name].filter(Boolean).join(", ") || "—",
      quotationNumber: input.quotationNumber,
      reason: input.reason,
      inspector: input.inspectorName,
      jobUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/snagging/${row.id}`,
    });
  } catch (error) {
    console.error("[snagging] void quotation email not sent:", error instanceof Error ? error.message : error);
  }
}

export interface QuotationVoidInfo {
  /** Set when this quotation is void. */
  voided_at: string | null;
  void_reason: string | null;
  /** The revised quotation raised in place of this void one. */
  replaced_by: { id: string; quote_number: string; status: string } | null;
  /** The void quotation this one revises. */
  revises: { id: string; quote_number: string } | null;
}

/** What the quotation page says about void and revision; null when neither applies. */
export async function quotationVoidInfo(admin: Admin, quotationId: string): Promise<QuotationVoidInfo | null> {
  if (!(await voidColumnsReady(admin))) return null;
  const [{ data: own }, { data: revisesRow }] = await Promise.all([
    admin.from("snagging_quotations").select(VOID_COLUMNS).eq("id", quotationId).maybeSingle(),
    admin.from("snagging_quotations").select("id, quote_number").eq("replaced_by_quotation_id", quotationId).limit(1).maybeSingle(),
  ]);
  const row = own as Row | null;
  const replacedId = (row?.replaced_by_quotation_id as string | null) ?? null;
  const { data: replaced } = replacedId
    ? await admin.from("snagging_quotations").select("id, quote_number, status").eq("id", replacedId).maybeSingle()
    : { data: null };
  if (!row?.voided_at && !revisesRow) return null;
  const rep = replaced as Row | null;
  const rev = revisesRow as Row | null;
  return {
    voided_at: (row?.voided_at as string | null) ?? null,
    void_reason: (row?.void_reason as string | null) ?? null,
    replaced_by: rep ? { id: String(rep.id), quote_number: String(rep.quote_number ?? ""), status: String(rep.status) } : null,
    revises: rev ? { id: String(rev.id), quote_number: String(rev.quote_number ?? "") } : null,
  };
}
