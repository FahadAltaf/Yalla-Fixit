import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Alerts on the technician's / inspector's phone for AMC work (22 Nov 2026),
  as Snagging sends them: a row in snagging_notifications, which the
  database webhook pushes to the YFI app (app/api/snagging/push/send) and
  the app lists (app/api/snagging/sync/alerts). amc_kind and amc_id say
  which AMC visit, call out, additional work or site visit a tap opens.

    assigned          given to them (a new crew member, a new inspector)
    rescheduled       moved to another time, or taken off them
    visit_sent_back   their job sheet / site visit came back to fix

  Who gets one (22 Nov 2026), as Snagging decides it: only the people on
  that work (its crew, through their portal login, or its inspector), never
  a whole role. Of those: not someone whose portal user is switched off,
  not the person who made the change (they know), and the same alert to
  the same person twice within a minute (a double save) is sent once. The
  push itself reaches only phones signed in to the YFI app.

  Best effort: an alert that cannot be written never stops the change.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export type CrewAlertKind = "ppm" | "call_out" | "additional_work" | "site_visit";
export type CrewAlertType = "assigned" | "rescheduled" | "visit_sent_back";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The portal logins of FSM technicians (technician_reference); a technician without one gets no alert. */
export async function usersForTechnicians(admin: Admin, fsmIds: string[]): Promise<string[]> {
  const ids = [...new Set(fsmIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await admin.from("technician_reference").select("user_profile_id").in("fsm_resource_id", ids).not("user_profile_id", "is", null);
  if (error) return [];
  return [...new Set(((data ?? []) as Row[]).map((r) => str(r.user_profile_id)).filter((u): u is string => Boolean(u)))];
}

/** "Mon 24 Nov, 09:00" in Dubai. */
export function whenLabel(iso: string | null | undefined): string {
  if (!iso) return "time to be set";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
}

export async function alertCrew(
  admin: Admin,
  input: {
    kind: CrewAlertKind;
    id: string;
    type: CrewAlertType;
    title: string;
    body: string;
    userIds?: string[];
    fsmIds?: string[];
    whenAt?: string | null;
    /* Taken off it: the tap opens the Alerts tab, not a record they can no longer see (the YFI app, 22 Nov 2026). */
    noLink?: boolean;
    /** Who made the change: not alerted about their own action. */
    actorId?: string | null;
  },
): Promise<number> {
  try {
    const named = [...new Set([...(input.userIds ?? []), ...(await usersForTechnicians(admin, input.fsmIds ?? []))].filter(Boolean))].filter((u) => u !== input.actorId);
    const users = await recipientsFor(admin, named, input);
    if (!users.length) return 0;
    const rows = users.map((userId) => ({
      user_id: userId,
      type: input.type,
      amc_kind: input.kind,
      amc_id: input.noLink ? null : input.id,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      ...(input.whenAt ? { when_at: input.whenAt } : {}),
    }));
    let { error } = await admin.from("snagging_notifications").insert(rows);
    /* Before when_at exists: without it. */
    if (error && /when_at/.test(error.message ?? "")) ({ error } = await admin.from("snagging_notifications").insert(rows.map((r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "when_at")))));
    if (error) {
      console.error(`[amc:crew-alerts] ${input.type} not written:`, error.message);
      return 0;
    }
    return users.length;
  } catch (e) {
    console.error("[amc:crew-alerts] failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Of the people named: active portal users only, without one who had this same alert in the last minute. */
async function recipientsFor(admin: Admin, named: string[], input: { kind: CrewAlertKind; id: string; type: CrewAlertType; title: string; noLink?: boolean }): Promise<string[]> {
  if (!named.length) return [];
  const { data: people, error } = await admin.from("user_profile").select("id, is_active").in("id", named);
  /* If the profiles cannot be read, the alert still goes to everyone named. */
  const off = new Set(error ? [] : ((people ?? []) as Row[]).filter((p) => p.is_active === false).map((p) => String(p.id)));
  const active = named.filter((id) => !off.has(id));
  if (!active.length) return [];
  const since = new Date(Date.now() - 60_000).toISOString();
  let recent = admin.from("snagging_notifications").select("user_id").in("user_id", active).eq("type", input.type).eq("title", input.title.slice(0, 200)).gte("created_at", since);
  recent = input.noLink ? recent.is("amc_id", null) : recent.eq("amc_id", input.id);
  const { data: dupes, error: dupError } = await recent;
  const already = new Set(dupError ? [] : ((dupes ?? []) as Row[]).map((d) => String(d.user_id)));
  return active.filter((id) => !already.has(id));
}

/** Who joined, who left, and whether the time moved for those who stayed. */
export function crewChanges(before: { ids: string[]; start: string | null }, after: { ids: string[]; start: string | null }) {
  const was = new Set(before.ids.filter(Boolean));
  const now = new Set(after.ids.filter(Boolean));
  const moved = (before.start ? Date.parse(before.start) : null) !== (after.start ? Date.parse(after.start) : null);
  return {
    added: [...now].filter((id) => !was.has(id)),
    removed: [...was].filter((id) => !now.has(id)),
    kept: [...now].filter((id) => was.has(id)),
    moved,
  };
}

/**
 * The crew's alerts after a slot or crew change: new members are told it
 * is theirs, those taken off are told it is not any more, and those who
 * stay are told the new time when it moved.
 */
export async function alertCrewChange(
  admin: Admin,
  input: {
    kind: CrewAlertKind;
    id: string;
    what: string;
    where: string;
    before: { ids: string[]; start: string | null };
    after: { ids: string[]; start: string | null };
    /** Who made the change: not alerted about their own action. */
    actorId?: string | null;
  },
): Promise<number> {
  const c = crewChanges(input.before, input.after);
  let sent = 0;
  if (c.added.length) {
    sent += await alertCrew(admin, {
      kind: input.kind,
      id: input.id,
      actorId: input.actorId,
      type: "assigned",
      fsmIds: c.added,
      title: `New ${input.what}`,
      body: `${input.where}: ${whenLabel(input.after.start)}. Open it in the app for the details.`,
      whenAt: input.after.start,
    });
  }
  if (c.removed.length) {
    sent += await alertCrew(admin, {
      kind: input.kind,
      id: input.id,
      actorId: input.actorId,
      type: "rescheduled",
      fsmIds: c.removed,
      noLink: true,
      title: `Taken off ${input.what}`,
      body: `${input.where}: it is no longer on your list.`,
    });
  }
  if (c.kept.length && c.moved) {
    sent += await alertCrew(admin, {
      kind: input.kind,
      id: input.id,
      actorId: input.actorId,
      type: "rescheduled",
      fsmIds: c.kept,
      title: `${input.what.charAt(0).toUpperCase()}${input.what.slice(1)} moved`,
      body: `${input.where}: now ${whenLabel(input.after.start)}${input.before.start ? ` (was ${whenLabel(input.before.start)})` : ""}.`,
      whenAt: input.after.start,
    });
  }
  return sent;
}
