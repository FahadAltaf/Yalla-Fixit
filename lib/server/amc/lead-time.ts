import type { SupabaseClient } from "@supabase/supabase-js";

import { todayInDubai } from "@/lib/amc/contracts";
import { leadTimeMessage, leadTimeShortfall, type LeadTimeRule, type LeadTimeShortfall } from "@/lib/amc/lead-time";
import { effectiveAccess, type AccessStatus } from "@/lib/amc/visits";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

/** The property's active access rules, as the lead-time check reads them. */
export async function propertyLeadTimeRules(admin: Admin, propertyId: string | null | undefined): Promise<LeadTimeRule[]> {
  if (!propertyId) return [];
  const { data, error } = await admin.from("amc_property_access_rules").select("access_type, issuer, lead_time_days").eq("property_id", propertyId).eq("active", true);
  if (error) return [];
  return ((data ?? []) as Row[]).map((r) => ({
    accessType: String(r.access_type ?? "access"),
    issuer: typeof r.issuer === "string" ? r.issuer : null,
    leadTimeDays: r.lead_time_days === null || r.lead_time_days === undefined ? null : Number(r.lead_time_days),
  }));
}

/**
 * DEV-493: a booking on `day` inside the property's access lead time is
 * refused (409, LEAD_TIME_MARK) until the user says to book anyway
 * (acknowledged). Access already in hand (accessReady) needs no notice.
 * Returns the shortfall that was accepted, for the caller's history.
 */
export async function checkLeadTime(
  admin: Admin,
  propertyId: string | null | undefined,
  day: string,
  opts: { acknowledged?: boolean | null; accessReady?: boolean; now?: Date } = {},
): Promise<LeadTimeShortfall | null> {
  if (opts.accessReady) return null;
  const shortfall = leadTimeShortfall(await propertyLeadTimeRules(admin, propertyId), day, todayInDubai(opts.now ?? new Date()));
  if (!shortfall) return null;
  if (!opts.acknowledged) throw new ContractError(leadTimeMessage(shortfall), 409);
  return shortfall;
}

/** The contract's property, whose access rules a booking is checked against. */
export async function contractPropertyId(admin: Admin, contractId: string): Promise<string | null> {
  const { data } = await admin.from("amc_contracts").select("property_id").eq("id", contractId).maybeSingle<Row>();
  return typeof data?.property_id === "string" ? data.property_id : null;
}

/** A call out's or additional work's pass in hand for that day (approved, or marked not needed); false before the access columns exist. */
export async function fieldAccessReady(admin: Admin, kind: "call_out" | "additional_work", id: string, day: string): Promise<boolean> {
  const { data, error } = await admin
    .from(kind === "call_out" ? "amc_call_outs" : "amc_additional_works")
    .select("access_status, access_valid_until")
    .eq("id", id)
    .maybeSingle<Row>();
  if (error || !data) return false;
  const status = typeof data.access_status === "string" ? (data.access_status as AccessStatus) : null;
  const until = typeof data.access_valid_until === "string" ? data.access_valid_until : null;
  return ["approved", "not_required"].includes(String(effectiveAccess(status, until, day)));
}

/**
 * A call out or additional work booked on `day` (DEV-493): checked against
 * the contract property's lead time; booked anyway is written to its
 * history.
 */
export async function checkFieldLeadTime(
  admin: Admin,
  input: { kind: "call_out" | "additional_work"; id: string; contractId: string; day: string; acknowledged?: boolean | null },
  actor: { id: string | null; label: string | null },
): Promise<LeadTimeShortfall | null> {
  const shortfall = await checkLeadTime(admin, await contractPropertyId(admin, input.contractId), input.day, {
    acknowledged: input.acknowledged,
    accessReady: await fieldAccessReady(admin, input.kind, input.id, input.day),
  });
  if (shortfall) {
    await recordAmcAudit(admin, {
      entityType: input.kind,
      entityId: input.id,
      eventType: "booked_inside_lead_time",
      actorId: actor.id,
      actorLabel: actor.label,
      payload: { date: input.day, ...shortfall },
    });
  }
  return shortfall;
}
