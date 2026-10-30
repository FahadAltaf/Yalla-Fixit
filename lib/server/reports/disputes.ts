import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { EVENT_KIND_LABELS, WAIVER_REASONS, type EventOutcome } from "@/lib/reports/compliance";
import {
  COMPLIANCE_ALERT_EVENTS,
  dayName,
  disputeRefusal,
  disputeStatus,
  eventLabel,
  settledCompliance,
  type Dispute,
  type DisputeStatus,
} from "@/lib/reports/compliance-disputes";
import { todayInZone } from "@/lib/scheduling/org-time";
import { createNotifier, supabaseNotificationStore } from "@/lib/server/notifications/notifier";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { sendEmail } from "@/lib/server/send-email";

import { ComplianceError, loadDisputes, workOutMonth } from "./compliance";

/**
 * Compliance disputes (BRD 5.2 B4, §6.8, N12, TC14; DEV-449) and the
 * technician's own view (§6.7: "own compliance, misses and monthly
 * statement; raise disputes").
 *
 *  - Raised by the technician, for a check-in of their own, found from the
 *    signed-in account (technician_reference.user_profile_id), never from
 *    an id in the request; or by a supervisor or coordinator (Compliance
 *    Edit) for them.
 *  - Decided only by the reviewers named in Settings → Reporting (D-10):
 *    no role grants it, administrators included.
 *  - N12 tells the reviewers when one is raised and stops showing once it
 *    is decided.
 */

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const raiseDisputeSchema = z
  .object({
    month: MONTH,
    eventKey: z.string().min(5).max(200),
    reason: z.string().trim().min(3, "Say why the check-in was missed").max(2000),
    /** Raised by a supervisor or coordinator for the technician. */
    onBehalf: z.boolean().default(false),
  })
  .strict();

export const decideDisputeSchema = z
  .object({
    outcome: z.enum(["accepted", "rejected"]),
    waiverReason: z.enum(WAIVER_REASONS).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.outcome !== "accepted" || Boolean(v.waiverReason), { message: "Choose the reason the miss is waived for", path: ["waiverReason"] })
  .refine((v) => v.outcome !== "rejected" || (v.note ?? "").length >= 3, { message: "Say why the dispute is rejected", path: ["note"] });

type Actor = { id: string; label: string };

/** The FSM technician this portal account is, if any. */
export async function technicianOfUser(admin: SupabaseClient, userId: string): Promise<{ fsmId: string; name: string } | null> {
  const { data, error } = await admin
    .from("technician_reference")
    .select("fsm_resource_id, display_name")
    .eq("user_profile_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { fsmId: String(data.fsm_resource_id), name: String(data.display_name ?? data.fsm_resource_id) } : null;
}

export async function raiseDispute(
  admin: SupabaseClient,
  input: z.infer<typeof raiseDisputeSchema>,
  actor: Actor,
  who: { self: string } | { onBehalf: true },
): Promise<{ id: string }> {
  const technician = input.eventKey.split("|")[0];
  if ("self" in who && technician !== who.self) throw new ComplianceError("You can dispute only your own check-ins.", 403);

  const [work, stored, { data: monthRow }] = await Promise.all([
    workOutMonth(admin, input.month, { technician }),
    loadDisputes(admin, input.month, technician),
    admin.schema("hr").from("compliance_months").select("month").eq("month", input.month).maybeSingle(),
  ]);
  if (!stored.ready) throw new ComplianceError("Disputes need migration 20261029100000 to be applied first.", 409);
  const event = work.results.get(technician)?.events.find((e) => e.key === input.eventKey);
  const refusal = disputeRefusal({
    event,
    phase: work.phase,
    finalized: Boolean(monthRow),
    alreadyDisputed: stored.disputes.some((d) => d.eventKey === input.eventKey),
  });
  if (refusal) throw new ComplianceError(refusal, 409);
  const e = event as EventOutcome;

  const { data, error } = await admin.schema("hr").rpc("raise_dispute", {
    p_event: {
      key: e.key,
      technician,
      kind: e.kind,
      month: input.month,
      date: e.date,
      due_at: e.dueAt,
      appointment_number: e.appointmentNumber,
    },
    p_reason: input.reason,
    p_cutoff: work.phase.cutoffDate,
    p_on_behalf: "onBehalf" in who,
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) {
    if (error.code === "23514" || error.code === "23505") throw new ComplianceError(error.message.replace(/^raise_dispute: /, ""), 409);
    throw new Error(error.message);
  }
  const id = String(data);

  /* N12: "{technician} disputed a missed {event} on {date}: {reason}". To the dispute reviewers. */
  const settings = await readReportingSettings(admin);
  const reviewers = settings.compliance.disputeReviewerUserIds;
  if (reviewers.length) {
    const name = work.roster.get(technician)?.name ?? technician;
    const notify = createNotifier({
      store: supabaseNotificationStore(admin),
      sendEmail: (mail) => sendEmail(mail),
      appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL,
    });
    await notify({
      event: COMPLIANCE_ALERT_EVENTS.dispute,
      entityType: "compliance_dispute",
      entityId: id,
      dedupeKey: `n12:${id}`,
      recipients: reviewers.map((userId) => ({ userId })),
      channels: ["in_app"],
      title: "Compliance dispute to review",
      body: `${name} disputed a missed ${eventLabel(e)} on ${dayName(e.date)}: ${input.reason.slice(0, 300)}`,
      link: `/reports/compliance?month=${input.month}&view=disputes`,
      requiresAction: true,
    });
  }
  return { id };
}

export async function decideDispute(
  admin: SupabaseClient,
  disputeId: string,
  input: z.infer<typeof decideDisputeSchema>,
  actor: Actor,
): Promise<{ outcome: "accepted" | "rejected" }> {
  const settings = await readReportingSettings(admin);
  if (!settings.compliance.disputeReviewerUserIds.includes(actor.id)) {
    throw new ComplianceError("Only the dispute reviewers named in Settings → Reporting can decide a dispute.", 403);
  }
  const { data, error } = await admin.schema("hr").rpc("decide_dispute", {
    p_dispute: disputeId,
    p_outcome: input.outcome,
    p_waiver_reason: input.waiverReason ?? null,
    p_note: input.note ?? null,
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) {
    if (error.code === "P0002") throw new ComplianceError("No such dispute.", 404);
    if (error.code === "23514" || error.code === "23505") throw new ComplianceError(error.message.replace(/^decide_dispute: /, ""), 409);
    throw new Error(error.message);
  }
  /* N12 stops showing once resolved. */
  const { error: resolveError } = await admin
    .from("portal_notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("event", COMPLIANCE_ALERT_EVENTS.dispute)
    .eq("dedupe_key", `n12:${disputeId}`)
    .is("resolved_at", null);
  if (resolveError) console.error("[disputes] N12 not resolved:", resolveError.message);
  return { outcome: data === "accepted" ? "accepted" : "rejected" };
}

// ---------------------------------------------------------------------
// The technician's own view
// ---------------------------------------------------------------------

export type MyComplianceEvent = {
  key: string;
  kind: EventOutcome["kind"];
  kindLabel: string;
  date: string;
  dueAt: string | null;
  appointmentNumber: string | null;
  state: EventOutcome["state"];
  recordedAt: string | null;
  waiverReason: string | null;
  dispute: { status: DisputeStatus; reason: string; note: string | null; raisedAt: string } | null;
  /** Null when it can be disputed now; otherwise why not. */
  cannotDispute: string | null;
};

export type MyCompliance =
  | { linked: false }
  | {
      linked: true;
      technician: { fsmId: string; name: string };
      month: string;
      from: string;
      to: string;
      phase: "running" | "disputes_open" | "final";
      cutoffDate: string;
      finalized: boolean;
      disputesReady: boolean;
      settings: { thresholdPercent: number | null; penaltyPerMissAed: number; monthlyCapAed: number };
      figures: {
        required: number;
        performed: number;
        missed: number;
        waived: number;
        compliancePercent: number | null;
        belowThreshold: boolean | null;
        penaltyBeforeCapAed: number | null;
        penaltyPayableAed: number | null;
      };
      /** Before today only: what a late check-in can no longer change. */
      settledPercent: number | null;
      events: MyComplianceEvent[];
      months: Array<{ id: string; name: string }>;
    };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function lastMonths(today: string, count: number) {
  const out: Array<{ id: string; name: string }> = [];
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < count; i += 1) {
    out.push({ id: `${y}-${String(m).padStart(2, "0")}`, name: `${MONTH_NAMES[m - 1]} ${y}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export async function buildMyCompliance(admin: SupabaseClient, userId: string, month: string | undefined): Promise<MyCompliance> {
  const me = await technicianOfUser(admin, userId);
  if (!me) return { linked: false };
  const today = todayInZone();
  const wanted = month ?? today.slice(0, 7);

  const [{ data: monthRow }, stored] = await Promise.all([
    admin.schema("hr").from("compliance_months").select("month").eq("month", wanted).maybeSingle(),
    loadDisputes(admin, wanted, me.fsmId),
  ]);
  const finalized = Boolean(monthRow);

  let figures: Extract<MyCompliance, { linked: true }>["figures"];
  let events: EventOutcome[] = [];
  const work = await workOutMonth(admin, wanted, { technician: me.fsmId });
  const mine = work.results.get(me.fsmId);
  if (finalized) {
    /* A finalised month is its frozen statement; the check-ins are shown as worked out. */
    const { data: s, error } = await admin
      .schema("hr")
      .from("compliance_statements")
      .select("*")
      .eq("month", wanted)
      .eq("technician_fsm_id", me.fsmId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    figures = {
      required: Number(s?.required ?? 0),
      performed: Number(s?.performed ?? 0),
      missed: Number(s?.missed ?? 0),
      waived: Number(s?.waived ?? 0),
      compliancePercent: n(s?.compliance_percent),
      belowThreshold: (s?.below_threshold as boolean | null) ?? null,
      penaltyBeforeCapAed: n(s?.penalty_before_cap),
      penaltyPayableAed: n(s?.penalty_payable),
    };
  } else {
    figures = {
      required: mine?.required ?? 0,
      performed: mine?.performed ?? 0,
      missed: mine?.missed ?? 0,
      waived: mine?.waived ?? 0,
      compliancePercent: mine?.compliancePercent ?? null,
      belowThreshold: mine?.belowThreshold ?? null,
      penaltyBeforeCapAed: mine?.penaltyBeforeCapAed ?? null,
      penaltyPayableAed: mine?.penaltyPayableAed ?? null,
    };
  }
  events = mine?.events ?? [];
  const byEvent = new Map<string, Dispute>(stored.disputes.map((d) => [d.eventKey, d]));

  return {
    linked: true,
    technician: me,
    month: wanted,
    from: work.from,
    to: work.to,
    phase: work.phase.phase,
    cutoffDate: work.phase.cutoffDate,
    finalized,
    disputesReady: stored.ready,
    settings: {
      thresholdPercent: work.settings.thresholdPercent,
      penaltyPerMissAed: work.settings.penaltyPerMissAed,
      monthlyCapAed: work.settings.monthlyCapAed,
    },
    figures,
    settledPercent: settledCompliance(events, today).percent,
    /* Misses first, then the latest. */
    events: events
      .map<MyComplianceEvent>((e) => {
        const d = byEvent.get(e.key);
        return {
          key: e.key,
          kind: e.kind,
          kindLabel: EVENT_KIND_LABELS[e.kind],
          date: e.date,
          dueAt: e.dueAt,
          appointmentNumber: e.appointmentNumber,
          state: e.state,
          recordedAt: e.recordedAt,
          waiverReason: e.waiver?.reason ?? null,
          dispute: d ? { status: disputeStatus(d), reason: d.reason, note: d.decision?.note ?? null, raisedAt: d.raisedAt } : null,
          cannotDispute: stored.ready
            ? disputeRefusal({ event: e, phase: work.phase, finalized, alreadyDisputed: Boolean(d) })
            : "Disputes are not open in the portal yet.",
        };
      })
      .sort((a, b) => Number(b.state === "missed") - Number(a.state === "missed") || (b.dueAt ?? b.date).localeCompare(a.dueAt ?? a.date)),
    months: lastMonths(today, 6),
  };
}
