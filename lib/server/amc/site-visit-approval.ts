import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { assetSchema, scopeItemSchema } from "@/lib/amc/client-profile";
import { recordAmcAudit, recordAmcAudits } from "@/lib/server/amc/audit";
import { getAssessment, type AssessmentRecord } from "@/lib/server/amc/business";
import {
  createAssets,
  createScopeItems,
  listAssets,
  listScope,
  retireAsset,
  updateAsset,
  updateScopeItem,
  type AssetRecord,
  type ScopeItemRecord,
} from "@/lib/server/amc/client-profile";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { alertCrew } from "@/lib/server/amc/crew-alerts";
import { siteVisitDeciders } from "@/lib/server/amc/site-visit-approvers";
import type { z } from "zod";

/**
 * Site visit approval (16 Nov 2026).
 *
 * A site visit is booked with an approver: somebody whose role can approve
 * in AMC. The inspector records the visit and completes it on the mobile
 * app. The scope and asset changes they make there are held on the visit
 * (amc_site_visit_changes, one row per asset or scope item with its net
 * change) instead of going straight onto the property. Only the named
 * approver can then approve the visit, which applies those changes to the
 * property, or send it back to the inspector with a reason.
 *
 * Before 20261116110000 is applied nothing is held: the phone's changes go
 * onto the property as they always did, and there is nothing to approve.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

/** Runs work once the caller has answered; outside a request (tests, scripts) straight away. */
function afterAnswer(work: () => Promise<unknown>): void {
  const run = () => work().then(
    () => undefined,
    (e) => console.error("[amc] after the answer:", e instanceof Error ? e.message : e),
  );
  try {
    after(run);
  } catch {
    void run();
  }
}
type AssetInput = z.infer<typeof assetSchema>;
type ScopeInput = z.infer<typeof scopeItemSchema>;

const CHANGES = "amc_site_visit_changes";
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export type SiteChangeEntity = "asset" | "scope";
export type SiteChangeOp = "insert" | "update" | "delete";

export interface SiteChange {
  entity: SiteChangeEntity;
  op: SiteChangeOp;
  targetId: string;
  payload: Record<string, unknown>;
  updatedAt: string;
}

/** A held change as the portal shows it: what the property has now, and what it will have. */
export interface SiteChangeView {
  entity: SiteChangeEntity;
  op: SiteChangeOp;
  targetId: string;
  before: AssetRecord | ScopeItemRecord | null;
  after: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/* Held changes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Holds one asset or scope change from the phone on the site visit, as its
 * net change. Returns false when the table is not there yet (the caller then
 * writes to the property as before).
 */
export async function holdSiteChange(
  admin: Admin,
  assessmentId: string,
  change: { entity: SiteChangeEntity; op: SiteChangeOp; targetId: string; payload?: Record<string, unknown> },
  actorId: string,
): Promise<boolean> {
  const key = { assessment_id: assessmentId, entity: change.entity, target_id: change.targetId };
  const { data: existing, error } = await admin
    .from(CHANGES)
    .select("op")
    .eq("assessment_id", assessmentId)
    .eq("entity", change.entity)
    .eq("target_id", change.targetId)
    .is("applied_at", null)
    .maybeSingle<Row>();
  if (error) {
    if (isMissingTable(error)) return false;
    throw new ContractError(error.message, 500);
  }
  const wasAdded = existing?.op === "insert";
  if (change.op === "delete" && wasAdded) {
    /* Added on this visit and taken out again: nothing for the property. */
    const { error: gone } = await admin.from(CHANGES).delete().eq("assessment_id", assessmentId).eq("entity", change.entity).eq("target_id", change.targetId);
    if (gone) throw new ContractError(gone.message, 500);
    return true;
  }
  /* Edited after being added on this visit: still an addition, with its latest details. */
  const op: SiteChangeOp = change.op === "update" && wasAdded ? "insert" : change.op;
  const { error: saved } = await admin.from(CHANGES).upsert(
    { ...key, op, payload: change.op === "delete" ? {} : (change.payload ?? {}), updated_at: new Date().toISOString(), updated_by: actorId, applied_at: null },
    { onConflict: "assessment_id,entity,target_id" },
  );
  if (saved) throw new ContractError(saved.message, 500);
  return true;
}

/** The changes a site visit holds, not yet applied (empty before the table exists). */
export async function heldSiteChanges(admin: Admin, assessmentId: string): Promise<SiteChange[]> {
  const { data, error } = await admin
    .from(CHANGES)
    .select("entity, op, target_id, payload, updated_at")
    .eq("assessment_id", assessmentId)
    .is("applied_at", null)
    .order("updated_at");
  if (error) {
    if (isMissingTable(error)) return [];
    throw new ContractError(error.message, 500);
  }
  return ((data ?? []) as Row[]).map((r) => ({
    entity: r.entity as SiteChangeEntity,
    op: r.op as SiteChangeOp,
    targetId: String(r.target_id),
    payload: (r.payload ?? {}) as Record<string, unknown>,
    updatedAt: String(r.updated_at),
  }));
}

/** How many changes are held and the latest, for the phone's version stamp. */
export async function heldSiteStamp(admin: Admin, assessmentId: string): Promise<string> {
  const { data, count, error } = await admin
    .from(CHANGES)
    .select("updated_at", { count: "exact" })
    .eq("assessment_id", assessmentId)
    .is("applied_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return "-";
  return `${count ?? 0}:${str((data?.[0] as Row | undefined)?.updated_at) ?? "-"}`;
}

/**
 * The property's assets and scope as the inspector sees them on the visit:
 * what the property has, with the visit's held changes laid over it.
 */
export function withHeldChanges(assets: AssetRecord[], scope: ScopeItemRecord[], changes: SiteChange[]): { assets: AssetRecord[]; scope: ScopeItemRecord[] } {
  let a = [...assets];
  let s = [...scope];
  for (const c of changes) {
    if (c.entity === "asset") {
      if (c.op === "delete") a = a.filter((x) => x.id !== c.targetId);
      else if (c.op === "update") a = a.map((x) => (x.id === c.targetId ? ({ ...x, ...c.payload } as AssetRecord) : x));
      else if (!a.some((x) => x.id === c.targetId)) {
        a.push({ ...(c.payload as unknown as AssetRecord), id: c.targetId, propertyId: "", status: "active", retiredAt: null, retiredReason: null, createdAt: c.updatedAt });
      }
    } else {
      if (c.op === "delete") s = s.filter((x) => x.id !== c.targetId);
      else if (c.op === "update") s = s.map((x) => (x.id === c.targetId ? ({ ...x, ...c.payload } as ScopeItemRecord) : x));
      else if (!s.some((x) => x.id === c.targetId)) {
        s.push({ ...(c.payload as unknown as ScopeItemRecord), id: c.targetId, propertyId: "", active: (c.payload.active as boolean | undefined) ?? true });
      }
    }
  }
  return { assets: a, scope: s };
}

/** An asset or scope item as the visit leaves it, with what the visit does to it (null: as the property has it). */
export type SiteAsset = AssetRecord & { change: SiteChangeOp | null };
export type SiteScopeItem = ScopeItemRecord & { change: SiteChangeOp | null };

/**
 * The property's scope and assets as the inspector left them on site (16
 * Nov 2026): what the property has, with the visit's held changes laid over
 * it and each row marked with what the visit does to it (a removed one is
 * kept, marked, until approval). Also the held changes on their own, for the
 * approver. Two reads of the property beside one of the visit's changes.
 */
export async function siteVisitPropertyView(
  admin: Admin,
  a: AssessmentRecord,
): Promise<{ assets: SiteAsset[]; scope: SiteScopeItem[]; changes: SiteChangeView[] }> {
  const propertyId = a.property?.id ?? null;
  if (!propertyId) return { assets: [], scope: [], changes: [] };
  const [liveAssets, liveScope, held] = await Promise.all([
    listAssets(admin, propertyId).then((r) => r.assets.filter((x) => x.status === "active")),
    listScope(admin, propertyId).then((r) => r.items.filter((x) => x.active)),
    heldSiteChanges(admin, a.id),
  ]);
  const heldOf = new Map(held.map((c) => [`${c.entity}:${c.targetId}`, c]));
  const merged = withHeldChanges(liveAssets, liveScope, held.filter((c) => c.op !== "delete"));
  const assets: SiteAsset[] = [
    ...merged.assets.map((x) => ({ ...x, change: heldOf.get(`asset:${x.id}`)?.op ?? null })),
  ];
  const scope: SiteScopeItem[] = [
    ...merged.scope.map((x) => ({ ...x, change: heldOf.get(`scope:${x.id}`)?.op ?? null })),
  ];
  const changes: SiteChangeView[] = held.map((c) => ({
    entity: c.entity,
    op: c.op,
    targetId: c.targetId,
    before: c.op === "insert" ? null : ((c.entity === "asset" ? liveAssets : liveScope).find((x) => x.id === c.targetId) ?? null),
    after: c.op === "delete" ? null : c.payload,
  }));
  return { assets, scope, changes };
}

/* ------------------------------------------------------------------ */
/* Approve, send back                                                  */
/* ------------------------------------------------------------------ */

/**
 * Who may approve or send back this visit (24 Nov 2026): the site visit
 * approvers in AMC configuration, and the person named on a visit booked
 * before that (when approvers were picked per visit).
 */
export async function siteVisitApprovers(admin: Admin, a: Pick<AssessmentRecord, "approverId">): Promise<{ ids: string[]; names: string[]; from: string }> {
  const d = await siteVisitDeciders(admin);
  return { ...d, ids: a.approverId && !d.ids.includes(a.approverId) ? [...d.ids, a.approverId] : d.ids };
}

/** Whether this user may approve the visit now. */
export async function canApproveSiteVisit(admin: Admin, a: AssessmentRecord, userId: string): Promise<boolean> {
  if (a.status !== "completed" || a.approvedAt || !a.approverId) return false;
  return (await siteVisitApprovers(admin, a)).ids.includes(userId);
}

async function assertApprover(admin: Admin, a: AssessmentRecord, userId: string) {
  if (a.status !== "completed") throw new ContractError("The inspector has not completed this site visit yet.", 409);
  if (a.approvedAt) throw new ContractError("This site visit is already approved.", 409);
  if (!a.approverId) throw new ContractError("This site visit has no approver.", 409);
  const d = await siteVisitApprovers(admin, a);
  if (!d.ids.includes(userId)) {
    throw new ContractError(`Only the site visit approvers set in AMC configuration${d.names.length ? ` (${d.names.join(", ")})` : ""} can approve or send back this site visit.`, 403);
  }
}

/**
 * Approves a completed site visit: its held asset changes go onto the
 * property first (a new scope item can point at a new asset), then its
 * scope changes. Only its named approver may.
 *
 * 26 Nov 2026: each change was applied and marked on its own, four calls
 * one after another, ~3 s a change on live (10 changes took ~28 s). New
 * assets and new scope items now go in one insert each, and the changes are
 * marked applied together at the end; a retry after a failure applies them
 * again harmlessly (an id already there is skipped, an update is the same
 * update, a removal of something gone is nothing).
 */
export async function approveSiteVisit(admin: Admin, id: string, actor: Actor): Promise<AssessmentRecord> {
  const a = await getAssessment(admin, id);
  await assertApprover(admin, a, actor.id);
  const propertyId = a.property?.id ?? null;
  const changes = await heldSiteChanges(admin, id);
  if (changes.length && !propertyId) throw new ContractError("The site visit has no property to apply its changes to.", 409);
  const where = `site visit ${a.assessmentNumber}`;
  const pid = propertyId!;
  const of = (entity: SiteChangeEntity, op: SiteChangeOp) => changes.filter((c) => c.entity === entity && c.op === op);

  await createAssets(admin, pid, of("asset", "insert").map((c) => ({ id: c.targetId, input: c.payload as unknown as AssetInput })), actor);
  for (const c of of("asset", "update")) await updateAsset(admin, pid, c.targetId, c.payload as unknown as AssetInput, actor);
  for (const c of changes.filter((x) => x.entity === "asset" && x.op !== "insert" && x.op !== "update")) {
    try {
      await retireAsset(admin, pid, c.targetId, `Removed on ${where}`, actor);
    } catch (e) {
      /* Already gone from the property: nothing left to remove. */
      if (!(e instanceof ContractError && e.status === 404)) throw e;
    }
  }
  await createScopeItems(admin, pid, of("scope", "insert").map((c) => ({ id: c.targetId, input: c.payload as unknown as ScopeInput })), actor);
  for (const c of of("scope", "update")) await updateScopeItem(admin, pid, c.targetId, c.payload as unknown as ScopeInput, actor);
  const removedScope = changes.filter((x) => x.entity === "scope" && x.op !== "insert" && x.op !== "update").map((c) => c.targetId);
  if (removedScope.length) {
    const { data: off, error: offError } = await admin
      .from("amc_scope_items")
      .update({ active: false, updated_at: new Date().toISOString() })
      .in("id", removedScope)
      .eq("property_id", pid)
      .eq("active", true)
      .select("id");
    if (offError) throw new ContractError(offError.message, 500);
    await recordAmcAudits(
      admin,
      ((off ?? []) as Row[]).map((r) => ({
        entityType: "property",
        entityId: pid,
        eventType: "scope_item_removed",
        actorId: actor.id,
        actorLabel: actor.label,
        payload: { scopeItemId: r.id, assessmentId: id },
      })),
    );
  }
  if (changes.length) {
    const { error: marked } = await admin.from(CHANGES).update({ applied_at: new Date().toISOString() }).eq("assessment_id", id).is("applied_at", null);
    if (marked) throw new ContractError(marked.message, 500);
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_assessments")
    .update({ approved_at: now, approved_by: actor.id, updated_at: now })
    .eq("id", id)
    .eq("status", "completed")
    .is("approved_at", null);
  if (error) throw new ContractError(error.message, 500);
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: id,
    eventType: "site_visit_approved",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { applied: { assets: changes.filter((c) => c.entity === "asset").length, scope: changes.filter((c) => c.entity === "scope").length } },
  });
  const tell = [a.assessorId, a.createdBy].filter((u): u is string => Boolean(u) && u !== actor.id);
  /* Sent once the approver has the answer (26 Nov 2026): the page is not kept waiting on it. */
  if (tell.length) {
    afterAnswer(() =>
      notifyUsers(admin, {
      event: "site_visit_approved",
      userIds: tell,
      title: `Site visit ${a.assessmentNumber} approved`,
      body: changes.length
        ? `${actor.label ?? "The approver"} approved it; ${changes.length} change${changes.length === 1 ? "" : "s"} to the property's scope and assets are now on the property.`
        : `${actor.label ?? "The approver"} approved it.`,
      link: `/extensions/amc-contracts/assessments/${id}`,
      entityType: "assessment",
      entityId: id,
      dedupeKey: `site_visit_approved:${id}`,
      }),
    );
  }
  return getAssessment(admin, id);
}

/** Sends a completed site visit back to its inspector, with the reason; it is a draft again on their phone. */
export async function sendBackSiteVisit(admin: Admin, id: string, reason: string, actor: Actor): Promise<AssessmentRecord> {
  const a = await getAssessment(admin, id);
  await assertApprover(admin, a, actor.id);
  const text = reason.trim();
  if (text.length < 3) throw new ContractError("Say what the inspector should change.", 400);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_assessments")
    .update({ status: "draft", completed_at: null, completed_by: null, sent_back_at: now, sent_back_reason: text.slice(0, 2000), updated_at: now })
    .eq("id", id)
    .eq("status", "completed")
    .is("approved_at", null);
  if (error) throw new ContractError(error.message, 500);
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: id,
    eventType: "site_visit_sent_back",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { reason: text },
  });
  if (a.assessorId && a.assessorId !== actor.id) {
    await notifyUsers(admin, {
      event: "site_visit_sent_back",
      userIds: [a.assessorId],
      title: `Site visit ${a.assessmentNumber} sent back`,
      body: `${actor.label ?? "The approver"}: ${text}`.slice(0, 2000),
      link: `/extensions/amc-contracts/assessments/${id}`,
      entityType: "assessment",
      entityId: id,
      dedupeKey: `site_visit_sent_back:${id}:${now}`,
    });
    /* On the inspector's phone too. */
    await alertCrew(admin, { kind: "site_visit", id, type: "visit_sent_back", actorId: actor.id, userIds: [a.assessorId], title: `Site visit ${a.assessmentNumber} sent back`, body: text });
  }
  return getAssessment(admin, id);
}

/** Tells the approver a site visit is ready for them (called when it is completed). */
export async function notifyApproverReady(admin: Admin, a: AssessmentRecord): Promise<void> {
  if (!a.approverId || a.approvedAt) return;
  const held = await heldSiteChanges(admin, a.id);
  /* Every site visit approver from AMC configuration (24 Nov 2026), not one person. */
  const { ids } = await siteVisitApprovers(admin, a);
  await notifyUsers(admin, {
    event: "site_visit_to_approve",
    userIds: ids.length ? ids : [a.approverId],
    title: `Site visit ${a.assessmentNumber} is ready to approve`,
    body: `${a.assessorName ?? "The inspector"} completed it${held.length ? `, with ${held.length} change${held.length === 1 ? "" : "s"} to the property's scope and assets` : ""}.`,
    link: `/extensions/amc-contracts/assessments/${a.id}`,
    entityType: "assessment",
    entityId: a.id,
    dedupeKey: `site_visit_to_approve:${a.id}:${a.completedAt ?? ""}`,
  });
}
