import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { findLeaveConflicts, findOrCreateDraftVersion, leaveConflictName } from "@/lib/server/schedule-entries";
import { quoteFsmWorkOrderCopy, type WorkOrderCopyQuote } from "@/lib/server/zoho/work-order-copy";
import {
  DEFAULT_ORG_TIMEZONE,
  formatZonedDate,
  todayInZone,
  zonedDateString,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";
import { ActionType, ResourceType } from "@/types/types";

// FR-15: copy an entry to one or more later days, at the same clock times on
// the same technicians. Each chosen day gets its own copy; a day that was
// never opened is opened as a draft; an approved day is skipped; a
// technician on leave that day is left off.
//
// A note is copied as it is. An appointment is copied as a pending new
// appointment that, when its day is approved, first gets a NEW work order in
// Zoho FSM (a copy of the lines the original covered, same price) and then
// the appointment on it; the team confirmed this is how they copy by hand.
// The price is shown first (`quoteOnly`) and the real call must carry
// `priceConfirmed`. The portal never dispatches the new appointment.
const MAX_DAYS_AHEAD = 14;

const schema = z.object({
  entryId: z.string().uuid(),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(31),
  // Dates on which a copy of this entry already exists and may be added again.
  confirmDuplicates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  // Appointments only. "same_work_order": one day, and only when the source
  // lines are free in FSM (the original was cancelled or released them).
  mode: z.enum(["new_work_order", "same_work_order"]).optional(),
  quoteOnly: z.boolean().optional(),
  priceConfirmed: z.boolean().optional(),
  // The total (after tax) the person saw; a different figure now is refused.
  confirmedTotal: z.number().nonnegative().optional(),
});

export type CopyDayResult = {
  date: string;
  status: "copied" | "skipped" | "needs_confirmation";
  reason?: string;
  entryId?: string;
  droppedTechnicians?: string[];
  dayCreated?: boolean;
};

type SourceEntry = {
  id: string;
  entry_type: "existing_appointment" | "new_appointment" | "free_text";
  shift: string;
  operating_date: string;
  start_at: string;
  end_at: string;
  title: string | null;
  notes: string | null;
  client_name: string | null;
  contact_name: string | null;
  address: string | null;
  fsm_work_order_id: string | null;
  fsm_work_order_name: string | null;
  fsm_appointment_id: string | null;
  fsm_appointment_name: string | null;
  fsm_appointment_type: string | null;
  fsm_schedule_type: string | null;
  fsm_service_line_item_ids: string[] | null;
  fsm_create_work_order: boolean | null;
  fsm_copy_source_work_order_id: string | null;
  fsm_copy_source_work_order_name: string | null;
  fsm_copy_source_appointment_id: string | null;
  fsm_copy_source_appointment_name: string | null;
  fsm_copy_source_line_ids: string[] | null;
  schedule_entry_assignments: { technician_fsm_id: string }[] | null;
};

const SOURCE_COLUMNS =
  "id, entry_type, shift, operating_date, start_at, end_at, title, notes, client_name, contact_name, address, fsm_work_order_id, fsm_work_order_name, fsm_appointment_id, fsm_appointment_name, fsm_appointment_type, fsm_schedule_type, fsm_service_line_item_ids, fsm_create_work_order, fsm_copy_source_work_order_id, fsm_copy_source_work_order_name, fsm_copy_source_appointment_id, fsm_copy_source_appointment_name, fsm_copy_source_line_ids, schedule_entry_assignments(technician_fsm_id)";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { entryId } = parsed.data;
    const confirmed = new Set(parsed.data.confirmDuplicates ?? []);
    const mode = parsed.data.mode ?? "new_work_order";

    const admin = await createAdminServerClient();
    const { data: zoneRow } = await admin.from("settings").select("org_timezone").eq("id", 1).maybeSingle();
    const timeZone = zoneRow?.org_timezone || DEFAULT_ORG_TIMEZONE;
    const today = todayInZone(timeZone);

    const { data: sourceRow, error: sourceError } = await admin
      .from("schedule_entries")
      .select(SOURCE_COLUMNS)
      .eq("id", entryId)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!sourceRow) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    const source = sourceRow as unknown as SourceEntry;
    const isNote = source.entry_type === "free_text";

    // For an appointment: what the copy would contain and cost, read from
    // FSM now so the person confirms the real figure.
    let quote: WorkOrderCopyQuote | null = null;
    // The appointment the copy is "of": a copy of a copy still points at the
    // original, so labels and duplicate checks stay meaningful.
    const originWorkOrderId = source.fsm_copy_source_work_order_id || source.fsm_work_order_id;
    const originWorkOrderName = source.fsm_copy_source_work_order_name || source.fsm_work_order_name;
    const originAppointmentId = source.fsm_copy_source_appointment_id || source.fsm_appointment_id;
    const originAppointmentName = source.fsm_copy_source_appointment_name || source.fsm_appointment_name;
    if (!isNote) {
      if (!source.fsm_work_order_id) {
        return NextResponse.json({ error: "This appointment has no work order to copy." }, { status: 400 });
      }
      const quoted = await quoteFsmWorkOrderCopy({
        workOrderId: source.fsm_work_order_id,
        appointmentId: source.fsm_appointment_id,
        lineIds: source.fsm_service_line_item_ids,
      });
      if (!quoted.ok) {
        const detail = quoted.json?.error ?? "Could not read the work order from Zoho FSM";
        return NextResponse.json({ error: detail }, { status: quoted.status >= 400 && quoted.status < 600 ? quoted.status : 502 });
      }
      quote = quoted.json.quote as WorkOrderCopyQuote;
      const shaped = {
        workOrderName: source.fsm_work_order_name ?? quote.workOrderName,
        appointmentName: source.fsm_appointment_name,
        summary: quote.summary ?? source.title,
        currency: quote.currency,
        lines: quote.lines.map((l) => ({
          code: l.code,
          service: l.service,
          quantity: l.quantity,
          amount: l.amount,
          lineAmount: l.lineAmount,
        })),
        parts: quote.parts.map((p) => ({
          code: p.code,
          service: p.service,
          quantity: p.quantity,
          amount: p.amount,
          lineAmount: p.lineAmount,
        })),
        subtotal: quote.subtotal,
        total: quote.total,
        linesFree: quote.linesFree,
      };
      if (parsed.data.quoteOnly) {
        return NextResponse.json({ data: { results: [], quote: shaped } });
      }
      if (!parsed.data.priceConfirmed) {
        return NextResponse.json(
          { error: "Confirm the price before copying.", data: { results: [], quote: shaped } },
          { status: 400 },
        );
      }
      // The figure confirmed must be the figure FSM gives now.
      if (
        typeof parsed.data.confirmedTotal === "number" &&
        Math.abs(parsed.data.confirmedTotal - quote.total) > 0.009
      ) {
        return NextResponse.json(
          {
            error: `The price changed while you were confirming: ${quote.currency} ${parsed.data.confirmedTotal.toFixed(2)} was shown, Zoho FSM now says ${quote.currency} ${quote.total.toFixed(2)}. Check the price again.`,
            data: { results: [], quote: shaped },
          },
          { status: 409 },
        );
      }
      if (mode === "same_work_order") {
        if (parsed.data.dates.length !== 1) {
          return NextResponse.json(
            { error: "A copy on the same work order can only be made for one day." },
            { status: 400 },
          );
        }
        if (!quote.linesFree) {
          return NextResponse.json(
            {
              error:
                "The original appointment still holds these service lines in Zoho FSM, so the copy needs a new work order.",
            },
            { status: 409 },
          );
        }
      }
    }

    const technicianIds = (source.schedule_entry_assignments ?? []).map((a) => a.technician_fsm_id);
    // The entry's position is its offset from midnight of the day it is listed
    // on (a night job at 01:00 belongs to the day before and starts after
    // 1440 minutes), so each copy keeps that same offset on its own day.
    const sourceDay = source.operating_date;
    const sourceMidnight = zonedTimeToUtc(sourceDay, "00:00:00", timeZone).getTime();
    const startOffsetMs = new Date(source.start_at).getTime() - sourceMidnight;
    const durationMs = new Date(source.end_at).getTime() - new Date(source.start_at).getTime();
    const sourceLabel = formatZonedDate(zonedTimeToUtc(sourceDay, "12:00", timeZone), {
      day: "numeric",
      month: "short",
    }, timeZone);
    const latest = zonedDateString(new Date(zonedTimeToUtc(today, "12:00", timeZone).getTime() + MAX_DAYS_AHEAD * 86_400_000), timeZone);
    const what = isNote ? "note" : "appointment";
    const copyLineIds = quote ? quote.lines.map((l) => l.id) : [];
    // The ORIGINAL appointment's lines: a copy of a copy (whose own work
    // order may already exist) still names them, so a second copy of the
    // same thing on one day is noticed.
    const originLineIds =
      source.fsm_copy_source_line_ids && source.fsm_copy_source_line_ids.length > 0
        ? source.fsm_copy_source_line_ids
        : copyLineIds;

    const results: CopyDayResult[] = [];
    const dates = [...new Set(parsed.data.dates)].sort();
    for (const date of dates) {
      if (date === sourceDay) {
        results.push({ date, status: "skipped", reason: `This is the day the ${what} is already on.` });
        continue;
      }
      if (date < today) {
        results.push({ date, status: "skipped", reason: "The day is in the past." });
        continue;
      }
      if (date > latest) {
        results.push({ date, status: "skipped", reason: `Copies can be made up to ${MAX_DAYS_AHEAD} days ahead.` });
        continue;
      }

      // Each day answers for itself: a failure on one day never undoes the
      // days already copied, and is reported in its place.
      try {
        await copyToDay(date);
      } catch (error) {
        console.error(`[entries/copy] ${date}:`, error);
        results.push({
          date,
          status: "skipped",
          reason: error instanceof Error ? error.message : "The copy failed.",
        });
      }
    }

    return NextResponse.json({ data: { results } });

    async function copyToDay(date: string) {
      const actor = profile!;
      const startAt = new Date(zonedTimeToUtc(date, "00:00:00", timeZone).getTime() + startOffsetMs);
      const endAt = new Date(startAt.getTime() + durationMs);

      // Leave is checked before the day is touched, so a day that is skipped
      // is not opened as a draft on the way.
      const conflicts = await findLeaveConflicts(admin, technicianIds, startAt.toISOString(), endAt.toISOString());
      const onLeave = new Set(conflicts.map((c) => c.technician_fsm_id));
      const keep = technicianIds.filter((id) => !onLeave.has(id));
      const dropped = conflicts.map((c) => leaveConflictName(c));
      if (technicianIds.length > 0 && keep.length === 0) {
        results.push({
          date,
          status: "skipped",
          reason: `Everyone on this ${what} is on leave that day: ${dropped.join(", ")}.`,
          droppedTechnicians: dropped,
        });
        return;
      }
      if (!isNote && keep.length === 0) {
        results.push({ date, status: "skipped", reason: "An appointment needs at least one technician." });
        return;
      }

      const found = await findOrCreateDraftVersion(admin, date, actor.id, timeZone);
      if (!found) {
        results.push({ date, status: "skipped", reason: "The day is in the past." });
        return;
      }
      const { version, created } = found;
      if (version.status !== "draft" && version.status !== "draft_revision") {
        results.push({
          date,
          status: "skipped",
          reason: `The day is ${version.status.replace(/_/g, " ")}. Open it and create a revision first.`,
        });
        return;
      }

      // The same thing on this day already: ask first.
      if (!confirmed.has(date)) {
        if (isNote) {
          const { data: twins } = await admin
            .from("schedule_entries")
            .select("id")
            .eq("schedule_version_id", version.id)
            .eq("entry_type", "free_text")
            .eq("title", source.title as string)
            .eq("start_at", startAt.toISOString())
            .limit(1);
          if ((twins ?? []).length > 0) {
            results.push({
              date,
              status: "needs_confirmation",
              reason: "A note with the same text is already on this day at this time.",
            });
            return;
          }
        } else {
          const { data: twins } = await admin
            .from("schedule_entries")
            .select("id, fsm_copy_source_line_ids")
            .eq("schedule_version_id", version.id)
            .eq("fsm_copy_source_work_order_id", originWorkOrderId as string);
          const twin = (twins ?? []).find((t) =>
            sameSet(((t.fsm_copy_source_line_ids as string[] | null) ?? []), originLineIds),
          );
          if (twin) {
            results.push({
              date,
              status: "needs_confirmation",
              reason: `A copy of ${originAppointmentName ?? originWorkOrderName ?? "this appointment"} is already on this day.`,
            });
            return;
          }
        }
      }

      // Same work order: the lines must not be pending on another new
      // appointment that day (the rule the Add dialog applies).
      if (!isNote && mode === "same_work_order") {
        const { data: rows, error: rowsError } = await admin
          .from("schedule_entries")
          .select("fsm_service_line_item_ids, fsm_create_work_order, fsm_created_work_order_id")
          .eq("schedule_version_id", version.id)
          .eq("entry_type", "new_appointment");
        if (rowsError) throw new Error(rowsError.message);
        const held = (rows ?? [])
          .filter((r) => !(r.fsm_create_work_order && !r.fsm_created_work_order_id))
          .flatMap((r) => ((r.fsm_service_line_item_ids as string[] | null) ?? []));
        if (copyLineIds.some((id) => held.includes(id))) {
          results.push({
            date,
            status: "skipped",
            reason: "These service lines are already on a pending appointment for this day.",
          });
          return;
        }
      }

      const copiedFrom = isNote
        ? `Copied from ${sourceLabel}`
        : `Copied from ${originAppointmentName ?? "the appointment"} on ${originWorkOrderName ?? "its work order"}, ${sourceLabel}`;
      const insertRow: Record<string, unknown> = {
        schedule_version_id: version.id,
        entry_type: isNote ? "free_text" : "new_appointment",
        shift: source.shift,
        operating_date: date,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        title: source.title,
        notes: [source.notes, copiedFrom].filter(Boolean).join("\n"),
        origin: "portal",
        sync_status: isNote ? "not_ready" : "ready",
        needs_sync: true,
        created_by: actor.id,
        updated_by: actor.id,
      };
      if (!isNote && quote) {
        const newWorkOrder = mode === "new_work_order";
        Object.assign(insertRow, {
          client_name: source.client_name,
          contact_name: source.contact_name,
          address: source.address,
          // Until approval creates the new work order, the entry points at
          // the SOURCE work order and names the source lines to copy.
          fsm_work_order_id: source.fsm_work_order_id,
          fsm_work_order_name: newWorkOrder
            ? `Copy of ${source.fsm_work_order_name ?? quote.workOrderName ?? "work order"}`
            : source.fsm_work_order_name ?? quote.workOrderName,
          fsm_service_line_item_ids: copyLineIds,
          fsm_service_task_line_item_ids: null,
          fsm_appointment_type: source.fsm_appointment_type,
          fsm_schedule_type: source.fsm_schedule_type ?? "Time-bound",
          fsm_create_work_order: newWorkOrder,
          fsm_copy_source_work_order_id: originWorkOrderId,
          fsm_copy_source_work_order_name: originWorkOrderName,
          fsm_copy_source_appointment_id: originAppointmentId,
          fsm_copy_source_appointment_name: originAppointmentName,
          fsm_copy_source_line_ids: originLineIds,
          fsm_copy_price: quote.total,
          fsm_copy_currency: quote.currency,
        });
      }
      const { data: entry, error: entryError } = await admin
        .from("schedule_entries")
        .insert(insertRow)
        .select("id")
        .single();
      if (entryError) throw new Error(entryError.message);

      if (keep.length > 0) {
        const { error: assignError } = await admin
          .from("schedule_entry_assignments")
          .insert(keep.map((id) => ({ schedule_entry_id: entry.id, technician_fsm_id: id })));
        if (assignError) {
          // Never leave an entry with nobody on it behind.
          await admin.from("schedule_entries").delete().eq("id", entry.id);
          throw new Error(assignError.message);
        }
      }

      after(async () => {
        await admin.from("schedule_audit_events").insert({
          event_type: "entry_added",
          actor_id: actor.id,
          origin: "portal",
          schedule_version_id: version.id,
          schedule_date: date,
          affected_entity_type: "schedule_entry",
          affected_entity_id: entry.id,
          after_value: {
            ...insertRow,
            technicians: keep,
            copied_from: source.id,
            copied_from_date: sourceDay,
            copy_mode: isNote ? null : mode,
            price_confirmed: isNote ? null : { total: quote?.total, currency: quote?.currency, lines: quote?.lines.length },
          },
        });
      });

      results.push({
        date,
        status: "copied",
        entryId: entry.id,
        droppedTechnicians: dropped,
        dayCreated: created,
      });
    }
  } catch (error) {
    console.error("Schedule entry copy error:", error);
    const message = error instanceof Error ? error.message : "Failed to copy the entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
