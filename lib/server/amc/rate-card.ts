import type { SupabaseClient } from "@supabase/supabase-js";

import { todayInDubai } from "@/lib/amc/contracts";
import { applyRateCard, diffRateCards, emptyRateCard, parseRateCard, versionInForce, type RateCard } from "@/lib/amc/rate-card";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";

/**
 * The rate card's published versions (amc_rate_card_versions). Publishing
 * adds a version effective from a date; nothing is ever edited, so every
 * old rate stays readable (BRD 5.3: who, when, old, new, effective from).
 * Rules are in lib/amc/rate-card.ts; routes check AMC Rate Card View/Edit.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

export const RATE_CARD_NOT_MIGRATED =
  "The rate card needs the AMC database update 20261007140000, which has not been applied to this database yet.";

export interface RateCardVersion {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  card: RateCard;
  reason: string;
  changedBy: string | null;
  createdAt: string;
  /** False when the stored card no longer validates (it then prices nothing). */
  valid: boolean;
}

function mapVersion(r: Row): RateCardVersion {
  const card = parseRateCard(r.card);
  const by = r.changer as Row | null;
  return {
    id: String(r.id),
    versionNo: Number(r.version_no),
    effectiveFrom: String(r.effective_from),
    card: card ?? emptyRateCard(),
    reason: String(r.reason),
    changedBy: (by?.full_name as string | null) || (by?.email as string | null) || null,
    createdAt: String(r.created_at),
    valid: card !== null,
  };
}

export async function listRateCardVersions(admin: Admin, limit = 200): Promise<{ versions: RateCardVersion[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_rate_card_versions")
    .select("id, version_no, effective_from, card, reason, created_at, changer:user_profile!amc_rate_card_versions_changed_by_fkey(full_name, email)")
    .order("version_no", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return { versions: [], migrated: false };
    throw new ContractError(error.message, 500);
  }
  return { versions: ((data ?? []) as unknown as Row[]).map(mapVersion), migrated: true };
}

/** The version that prices proposals on `day` (Dubai), or null before any is published or the update applied. */
export async function rateCardInForce(admin: Admin, day = todayInDubai()): Promise<RateCardVersion | null> {
  const { data, error } = await admin
    .from("amc_rate_card_versions")
    .select("id, version_no, effective_from, card, reason, created_at")
    .lte("effective_from", day)
    .order("effective_from", { ascending: false })
    .order("version_no", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new ContractError(error.message, 500);
  }
  const row = ((data ?? []) as Row[])[0];
  if (!row) return null;
  const version = mapVersion(row);
  return version.valid ? version : null;
}

export async function getRateCardVersion(admin: Admin, id: string): Promise<RateCardVersion | null> {
  const { data, error } = await admin.from("amc_rate_card_versions").select("id, version_no, effective_from, card, reason, created_at").eq("id", id).maybeSingle<Row>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new ContractError(error.message, 500);
  }
  return data ? mapVersion(data) : null;
}

/**
 * Publishes the card as a new version. Effective today or later (plan
 * assumption: a rate is never changed retroactively, so a proposal already
 * priced keeps its day's rate).
 */
export async function publishRateCard(
  admin: Admin,
  input: { card: RateCard; effectiveFrom: string; reason: string },
  actor: Actor,
  serviceLabel: (serviceId: string) => string = (s) => s,
): Promise<RateCardVersion> {
  const today = todayInDubai();
  if (input.effectiveFrom < today) throw new ContractError("A new card takes effect today or later, never in the past.", 400);
  const { versions } = await listRateCardVersions(admin, 50);
  const before = versionInForce(versions, input.effectiveFrom);
  const changes = diffRateCards(before?.card ?? emptyRateCard(), input.card, serviceLabel);
  if (before && changes.length === 0) throw new ContractError("Nothing changed from the card in force on that date.", 409);

  const { data, error } = await admin
    .from("amc_rate_card_versions")
    .insert({ effective_from: input.effectiveFrom, card: input.card, reason: input.reason.trim(), changed_by: actor.id })
    .select("id, version_no, effective_from, card, reason, created_at")
    .single<Row>();
  if (error) {
    if (isMissingTable(error)) throw new ContractError(RATE_CARD_NOT_MIGRATED, 503);
    throw new ContractError(error.message, 400);
  }
  const version = mapVersion(data);
  await recordAmcAudit(admin, {
    entityType: "rate_card",
    entityId: version.id,
    eventType: "rate_card_published",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: input.reason.trim(),
    payload: {
      versionNo: version.versionNo,
      effectiveFrom: version.effectiveFrom,
      replaces: before?.versionNo ?? null,
      /* Old and new value per field, kept with the event as well as derivable from the versions. */
      changes: changes.slice(0, 200),
    },
  });
  return version;
}

/**
 * What stops a proposal priced on the card from being submitted: a ticked
 * line without a rate, or at a frequency the card does not allow. Null for
 * a proposal priced as entered (no card) or a database without the update.
 */
export async function submissionRateProblem(admin: Admin, submissionId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("amc_submissions")
    .select("services, property, discount_percent, rate_card_version_id")
    .eq("id", submissionId)
    .maybeSingle<Row>();
  if (error || !data?.rate_card_version_id) return null;
  const version = await getRateCardVersion(admin, String(data.rate_card_version_id));
  if (!version?.valid) return null;
  const rows = (Array.isArray(data.services) ? data.services : []) as Parameters<typeof applyRateCard>[0];
  const model = String((data.property as Row | null)?.unitType ?? "");
  const { problems } = applyRateCard(rows, version.card, model, todayInDubai(), Number(data.discount_percent ?? 0));
  return problems.length ? `${problems.join(" ")} Correct the lines, or ask for the rate card to be updated.` : null;
}
