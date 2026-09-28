"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import CompanyLogo from "@/public/site-logo.webp";
import { Activity, Clock, TriangleAlert, Users } from "lucide-react";
import {
  scheduleService,
  type ScheduleEntry,
  type SchedulingConfig,
} from "@/modules/scheduling";
import {
  APPOINTMENT_STATE_LABELS,
  APPOINTMENT_STATE_ORDER,
  APPOINTMENT_STATE_STYLES,
  HEADLINE_STATES,
  resolveAppointmentState,
  type AppointmentState,
} from "@/lib/scheduling/appointment-status";
import {
  setOrgTimeZone,
  todayInZone,
  zonedMinutesOfDay,
} from "@/lib/scheduling/org-time";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/actions/utils";

// Wall-display view of the day's schedule.
//
// Read-only and unattended: it polls rather than waiting for interaction,
// never opens a dialog, and is sized to be legible across a room. It reuses
// the same endpoints the board uses, so there is no second source of truth.
//
// Live updates come over server-sent events: /api/scheduling/schedule/stream
// watches the day server-side and tells the screen when it has actually
// changed, so an edit lands in about a second and the heavy schedule route
// runs only when something really moved. Not websockets or a Supabase
// client subscription, because the portal exposes no browser Supabase key.
//
// The poll below is the fallback, not the mechanism: it covers a dropped
// stream, a proxy that strips SSE, and anything the fingerprint cannot see.
// It is deliberately slow, because the stream is what keeps the board live.
const REFRESH_MS = 120_000;
// Re-derive "now" often enough that the
// current-time marker glides rather than jumps.
const CLOCK_MS = 30_000;

function todayIso() {
  return todayInZone();
}

function minutesOfDay(iso: string) {
  return zonedMinutesOfDay(iso);
}

function hhmm(totalMinutes: number) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${suffix}`;
}

function parseHhmm(value: string, fallback: number) {
  const [h, m] = (value || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return h * 60 + m;
}

type Row = { technicianId: string; technicianName: string; entries: ScheduleEntry[] };

/** What a bar is called on the board, and in a message about it. */
function entryLabel(entry: ScheduleEntry): string {
  return (
    entry.fsm_work_order_name ||
    entry.fsm_appointment_name ||
    entry.title ||
    "Appointment"
  );
}

/**
 * What changed between two loads, in sentences an operator can read.
 *
 * The board is watched from across a room, so "something changed" is not
 * useful -- by the time anyone looks, the bar has already moved and there
 * is nothing to tell them what moved. This names it.
 *
 * Only the four things visible on the board are compared: whether an
 * appointment is there at all, its status colour, its times, and how many
 * technicians are on it. A change to a field the board does not draw is
 * not worth interrupting anyone for.
 */
function describeChanges(
  before: ScheduleEntry[],
  after: ScheduleEntry[],
): string[] {
  const previous = new Map(before.map((e) => [e.id, e]));
  const current = new Map(after.map((e) => [e.id, e]));
  const lines: string[] = [];

  for (const entry of after) {
    const was = previous.get(entry.id);
    if (!was) {
      lines.push(`${entryLabel(entry)} added`);
      continue;
    }
    if ((was.fsm_status ?? "") !== (entry.fsm_status ?? "")) {
      lines.push(
        `${entryLabel(entry)} is now ${entry.fsm_status ?? "unknown"}`,
      );
    }
    if (was.start_at !== entry.start_at || was.end_at !== entry.end_at) {
      lines.push(
        `${entryLabel(entry)} moved to ${hhmm(zonedMinutesOfDay(entry.start_at))}-${hhmm(zonedMinutesOfDay(entry.end_at))}`,
      );
    }
    const wasCount = was.schedule_entry_assignments?.length ?? 0;
    const nowCount = entry.schedule_entry_assignments?.length ?? 0;
    if (wasCount !== nowCount) {
      lines.push(
        `${entryLabel(entry)} now has ${nowCount} technician${nowCount === 1 ? "" : "s"}`,
      );
    }
  }

  for (const entry of before) {
    if (!current.has(entry.id)) lines.push(`${entryLabel(entry)} removed`);
  }

  return lines;
}

export default function ScheduleDisplay() {
  const [date, setDate] = useState(todayIso());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [config, setConfig] = useState<SchedulingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  /*
    Whether the last load failed.

    A ref, not state: nothing renders it any more. It exists so the
    warning is raised once per outage rather than on every retry, and so
    recovery can be announced when it comes back.
  */
  const failed = useRef(false);
  /** Whether the live channel is up; false falls back to the slow poll. */
  const [streaming, setStreaming] = useState(false);

  // Keeps the first paint from flashing an empty board on every poll.
  const loadedOnce = useRef(false);
  /** The last board we announced against, for diffing the next one. */
  const previous = useRef<ScheduleEntry[] | null>(null);
  /** Which date `previous` describes, so midnight does not announce a whole day. */
  const announcedFor = useRef<string | null>(null);
  /** The appointment whose details are open, if any. */
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);

  const load = useCallback(async (targetDate: string) => {
    try {
      const day = await scheduleService.getDay(targetDate);
      const next = day.entries ?? [];

      /*
        Say what moved, and leave it said.

        These toasts do not time out: the board is unattended, so a
        message that fades after three seconds is a message nobody saw.
        The operator dismisses each one, which doubles as an acknowledgement
        that somebody has actually read it.

        Nothing is announced for the first load, or after the date rolls
        over at midnight -- every appointment would be "added", which is
        noise rather than news.
      */
      const before = announcedFor.current === targetDate ? previous.current : null;
      if (before) {
        const changes = describeChanges(before, next);
        if (changes.length > 0) {
          /*
            Four at most, then a count. Twenty individual toasts would
            bury the screen in exactly the moment the board is busiest.
          */
          const shown = changes.slice(0, 4);
          const rest = changes.length - shown.length;
          toast.info("Schedule updated", {
            description:
              shown.join("\n") + (rest > 0 ? `\n+ ${rest} more change${rest === 1 ? "" : "s"}` : ""),
            duration: Infinity,
            closeButton: true,
          });
        }
      }

      previous.current = next;
      announcedFor.current = targetDate;

      setEntries(next);

      // Back after an outage: say so, and let that one clear itself.
      if (failed.current) {
        failed.current = false;
        toast.success("Schedule reconnected", { duration: 6_000 });
      }
    } catch {
      /*
        A failed poll must not blank a wall screen -- the last good board
        stays up. But a board that has quietly stopped updating is worse
        than one that is obviously broken, so it says so and keeps saying
        it until somebody dismisses it.
      */
      if (!failed.current) {
        failed.current = true;
        toast.error("Schedule is not updating", {
          description:
            "The board is showing the last version it managed to load. It will recover on its own once the connection is back.",
          duration: Infinity,
          closeButton: true,
        });
      }
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scheduleService
      .getConfig()
      .then((cfg) => {
        setOrgTimeZone(cfg.org_timezone);
        setConfig(cfg);
      }).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    load(date);
    const id = setInterval(() => load(date), REFRESH_MS);
    return () => clearInterval(id);
  }, [date, load]);

  /*
    The live channel.

    EventSource reconnects on its own after a drop, so there is no retry
    loop here; the slow poll above covers the window while it is down. The
    stream sends one event on connect, which is why this does not also
    load() itself -- the effect above already did.
  */
  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    const source = new EventSource(
      `/api/scheduling/schedule/stream?date=${encodeURIComponent(date)}`,
    );
    source.addEventListener("change", () => void load(date));
    /*
      A failed stream is not a failed board: the last good schedule stays
      up and the poll keeps it roughly current, so this marks staleness
      rather than blanking anything.
    */
    source.onerror = () => setStreaming(false);
    source.onopen = () => setStreaming(true);

    return () => source.close();
  }, [date, load]);

  // Roll over at midnight without anyone touching the screen.
  useEffect(() => {
    const id = setInterval(() => {
      const today = todayIso();
      setDate((current) => (current === today ? current : today));
    }, CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // The window the board spans: the union of both configured shifts, so a
  // single screen shows the whole operating day.
  const bounds = useMemo(() => {
    let start = 0;
    let end = 1440;

    if (config) {
      const nightStart = parseHhmm(config.night_shift_start, 0);
      let nightEnd = parseHhmm(config.night_shift_end, 9 * 60);
      const dayStart = parseHhmm(config.day_shift_start, 8 * 60);
      let dayEnd = parseHhmm(config.day_shift_end, 17 * 60);
      if (nightEnd <= nightStart) nightEnd += 1440;
      if (dayEnd <= dayStart) dayEnd += 1440;
      start = Math.min(nightStart, dayStart);
      end = Math.max(nightEnd, dayEnd);
    }

    /*
      The window has to hold the WORK, not just the shift definitions.

      Both shifts ended at 17:00 in the settings while real appointments
      ran to 18:00, so those bars were clipped at the right-hand edge --
      drawn short, while their own label read "6:00 PM". The board said
      two different things about the same appointment, and the one you
      could see was the wrong one. Whatever is actually scheduled widens
      the window now.
    */
    entries.forEach((entry) => {
      const entryStart = minutesOfDay(entry.start_at);
      let entryEnd = minutesOfDay(entry.end_at);
      if (entryEnd <= entryStart) entryEnd += 1440;
      if (entryStart < start) start = entryStart;
      if (entryEnd > end) end = entryEnd;
    });

    /*
      Whole hours, plus one at the end. The closing label is drawn to the
      right of its gridline, so without the extra hour it hangs off the
      board and lands on top of the hour before it.
    */
    return {
      start: Math.floor(start / 60) * 60,
      end: Math.ceil(end / 60) * 60 + 60,
    };
  }, [config, entries]);

  const span = Math.max(1, bounds.end - bounds.start);

  // One row per technician who actually has work today. A wall screen cannot
  // show ~90 idle rows, and empty rows are noise on a status board.
  const rows = useMemo<Row[]>(() => {
    const byTech = new Map<string, Row>();
    entries.forEach((entry) => {
      (entry.schedule_entry_assignments ?? []).forEach((a) => {
        const existing = byTech.get(a.technician_fsm_id);
        const name = a.technician_reference?.display_name ?? a.technician_fsm_id;
        if (existing) existing.entries.push(entry);
        else byTech.set(a.technician_fsm_id, { technicianId: a.technician_fsm_id, technicianName: name, entries: [entry] });
      });
    });
    return [...byTech.values()].sort((a, b) => a.technicianName.localeCompare(b.technicianName));
  }, [entries]);

  const stateOf = useCallback(
    (entry: ScheduleEntry): AppointmentState | "note" =>
      // A free-text entry is a note on the board, not a job: it has no FSM
      // status, so scoring it would mark every past note as Delayed.
      entry.entry_type === "free_text"
        ? "note"
        : resolveAppointmentState(entry.fsm_status),
    [],
  );

  const counts = useMemo(() => {
    const tally: Record<AppointmentState, number> = {
      new: 0, scheduled: 0, dispatched: 0, in_progress: 0, completed: 0, cannot_complete: 0, cancelled: 0, unknown: 0,
    };
    entries.forEach((e) => {
      const state = stateOf(e);
      if (state !== "note") tally[state] += 1;
    });
    return tally;
  }, [entries, stateOf]);

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = Math.ceil(bounds.start / 60) * 60; m <= bounds.end; m += 60) marks.push(m);
    return marks;
  }, [bounds]);

  // Greedy lane packing: an entry goes in the first lane whose last bar has
  // already finished, otherwise it opens a new one.
  const lanesFor = useCallback((rowEntries: ScheduleEntry[]) => {
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    [...rowEntries]
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .forEach((e) => {
        const start = new Date(e.start_at).getTime();
        const end = new Date(e.end_at).getTime();
        let lane = laneEnds.findIndex((last) => last <= start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(end);
        } else {
          laneEnds[lane] = end;
        }
        laneOf.set(e.id, lane);
      });
    return { laneOf, laneCount: Math.max(1, laneEnds.length) };
  }, []);

  const place = useCallback((entry: ScheduleEntry) => {
    const start = minutesOfDay(entry.start_at);
    let end = minutesOfDay(entry.end_at);
    if (end <= start) end += 1440;
    const visibleStart = Math.max(start, bounds.start);
    const visibleEnd = Math.min(end, bounds.end);
    if (visibleEnd <= visibleStart) return null;
    const left = ((visibleStart - bounds.start) / span) * 100;
    const width = Math.max(((visibleEnd - visibleStart) / span) * 100, 3);
    return { left, width: Math.min(width, 100 - left), start, end };
  }, [bounds.start, bounds.end, span]);

  /*
    The board's geometry, worked out once per data change.

    Lane packing sorts each technician's entries and `place` does the
    arithmetic for every bar. Both were running inline during render, for
    all ~80 rows, on EVERY render -- including the thirty-second clock
    tick whose only job is to nudge the red now-line. Keyed on the data
    and the window, so the tick now re-renders without redoing any of it.
  */
  const laidOut = useMemo(
    () =>
      rows.map((row) => {
        const { laneOf, laneCount } = lanesFor(row.entries);
        return {
          row,
          laneCount,
          bars: row.entries
            .map((entry) => ({
              entry,
              pos: place(entry),
              lane: laneOf.get(entry.id) ?? 0,
            }))
            .filter((b): b is typeof b & { pos: NonNullable<typeof b.pos> } =>
              b.pos !== null,
            ),
        };
      }),
    [rows, lanesFor, place],
  );

  return (
    /*
      Hover is instant here. The default delay is tuned for dense forms
      where tooltips would flicker as the pointer crosses them; a
      schedule bar is a large, deliberate target and the wait just reads
      as lag.
    */
    <TooltipProvider delayDuration={120}>
      <div className="bg-background text-foreground flex h-dvh w-full flex-col overflow-hidden">
        {/* ── Header: identity, liveness, and the day at a glance ───────── */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
          <div className="flex items-center gap-4">
            {/*
            White in dark mode. There is only the one colour asset, so the
            mark is knocked out to a silhouette rather than recoloured:
            inverting it would turn the brand red cyan, and a wall screen
            across a room needs contrast more than it needs the red.
          */}
            <Image
              src={CompanyLogo}
              alt=""
              height={44}
              className="h-15 w-auto object-contain dark:brightness-0 dark:invert"
              priority
              unoptimized
            />
            {/* <div>
            <h1 className="text-2xl leading-tight font-semibold">Daily Schedule</h1>
            <p className="text-muted-foreground text-sm">
              {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long", day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
          </div> */}
          </div>

          <div className="flex items-end gap-6">
            {/*
            Labelled "appointments", because the board does not draw them
            one to one.

            A row is a technician, so one appointment with fourteen people
            on it paints fourteen bars. Reading "IN PROGRESS 03" over
            fifty-seven orange bars looks like the count is broken; it is
            counting a different thing, and now says which.
          */}
            <div className="border-r pr-6">
              {/* <p className="text-muted-foreground mb-1 text-[0.6rem] font-medium tracking-widest uppercase">
              Appointments
            </p> */}
              <div className="flex items-end gap-6">
                {APPOINTMENT_STATE_ORDER.filter((s) => counts[s] > 0 || HEADLINE_STATES.has(s)).map((state) => (
                  <div key={state} className="text-center">
                    <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-[0.7rem] font-medium tracking-wider uppercase">
                      <span className={cn("size-2 rounded-full", APPOINTMENT_STATE_STYLES[state].dot)} />
                      {APPOINTMENT_STATE_LABELS[state]}
                    </p>
                    <p className={cn("text-4xl font-bold tabular-nums", APPOINTMENT_STATE_STYLES[state].text)}>
                      {String(counts[state]).padStart(2, "0")}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-muted-foreground flex items-center gap-1.5 text-[0.7rem] font-medium tracking-wider uppercase">
                <Users className="size-3.5" /> Technicians
              </p>
              <p className="text-4xl font-bold tabular-nums">{String(rows.length).padStart(2, "0")}</p>
            </div>

            {/* The connection state is stated once, in the footer. It used to
              sit here too, where a clock ticking beside the day's numbers
              drew the eye away from them. */}
          </div>
        </header>

        {/* ── Board ─────────────────────────────────────────────────────── */}
        <main className="min-h-0 flex-1 overflow-auto">
          {loading && !loadedOnce.current ? (
            <div className="text-muted-foreground flex h-full items-center justify-center gap-3 text-lg">
              <Activity className="size-6 animate-pulse" /> Loading today&apos;s schedule...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full">
                <Activity className="size-8" />
              </div>
              <h2 className="text-2xl font-semibold">Nothing scheduled today</h2>
              <p className="text-muted-foreground">
                Appointments appear here as soon as the day is published.
              </p>
            </div>
          ) : (
            <div className="min-w-[1100px]">
              {/* Hour ruler, sticky so it stays readable while rows scroll. */}
              <div className="bg-background sticky top-0 z-20 flex border-b">
                <div className="text-muted-foreground w-56 shrink-0 border-r px-4 py-2 text-xs font-medium">
                  Technician
                </div>
                <div className="relative min-w-0 flex-1">
                  {/*
                  Every label sits to the right of its own gridline, the
                  same way for all of them. The spare hour that `bounds`
                  adds is what gives the closing one room, so none of them
                  needs special-casing -- an earlier attempt to pull the
                  last one leftwards simply dropped it on its neighbour.
                */}
                  {hourMarks.map((m) => (
                    <div
                      key={m}
                      className="text-muted-foreground absolute inset-y-0 flex items-center border-l px-2 text-xs whitespace-nowrap tabular-nums"
                      style={{ left: `${((m - bounds.start) / span) * 100}%` }}
                    >
                      {hhmm(m)}
                    </div>
                  ))}
                  <div className="py-2 text-xs leading-none">&nbsp;</div>
                </div>
              </div>

              {laidOut.map(({ row, laneCount, bars }) => {
                return (
                  <div key={row.technicianId} className="flex border-b last:border-b-0">
                    <div className="flex w-56 shrink-0 items-center border-r px-4 py-3">
                      <span className="truncate text-base font-medium">{row.technicianName}</span>
                    </div>
                    <div className="relative min-w-0 flex-1 py-2">
                      {/* Hour gridlines, so a bar's position is readable. */}
                      {hourMarks.map((m) => (
                        <div
                          key={m}
                          className="border-border/60 absolute inset-y-0 border-l"
                          style={{ left: `${((m - bounds.start) / span) * 100}%` }}
                        />
                      ))}

                      <div
                        className="relative"
                        style={{ minHeight: `${laneCount * 3 + 0.25}rem` }}
                      >
                        {bars.map(({ entry, pos, lane }) => {
                          const state = stateOf(entry);
                          const styles =
                            state === "note"
                              ? { bar: "bg-muted text-foreground ring-border", dot: "", text: "" }
                              : APPOINTMENT_STATE_STYLES[state];
                          const stateLabel = state === "note" ? "Note" : APPOINTMENT_STATE_LABELS[state];
                          const label =
                            entry.entry_type === "free_text"
                              ? entry.title || "Note"
                              : entry.fsm_work_order_name || entry.fsm_appointment_name || "Appointment";
                          return (
                            <Tooltip key={entry.id}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => setSelected(entry)}
                                  aria-label={`${label}, ${stateLabel}, ${hhmm(pos.start)} to ${hhmm(pos.end)}`}
                                  className={cn(
                                    "absolute flex h-10 items-center gap-2 overflow-hidden rounded-md px-2.5 text-left ring-1",
                                    "focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
                                    "transition-[filter] hover:brightness-110",
                                    styles.bar,
                                  )}
                                  style={{
                                    left: `${pos.left}%`,
                                    width: `${pos.width}%`,
                                    top: `${lane * 3}rem`,
                                  }}
                                >
                                  {/*
                              What fits, by how wide the bar actually is.

                              A one-hour bar is ~60px. Asked to carry a
                              work order AND a time range it rendered
                              "10:00 AM-1", a truncation that reads as a
                              real time and is wrong. So a narrow bar keeps
                              only its identity, a medium one adds the
                              start, and the full range appears when there
                              is genuinely room. The tooltip and the dialog
                              carry the exact times either way.
                            */}
                                  <span className="truncate text-sm font-semibold">{label}</span>
                                  {/*
                              The whole range, not the start alone.

                              The start time was pushed to the bar's right
                              edge by ml-auto, so a 05:00-17:00 job showed
                              "5:00 AM" hard against its right end and read
                              as the time it finishes. On a board whose
                              only job is to say when work happens, that is
                              the one thing it must not get wrong.
                            */}
                                  {pos.width >= 14 ? (
                                    <span className="ml-auto shrink-0 text-xs font-medium tabular-nums opacity-90">
                                      {hhmm(pos.start)}&ndash;{hhmm(pos.end)}
                                    </span>
                                  ) : pos.width >= 7 ? (
                                    <span className="ml-auto shrink-0 text-xs font-medium tabular-nums opacity-90">
                                      {hhmm(pos.start)}
                                    </span>
                                  ) : null}
                                </button>
                              </TooltipTrigger>
                              {/*
                              The native title attribute took about a
                              second to appear and could not be styled or
                              read by anyone standing at the screen. This
                              shows the same facts immediately, and carries
                              the ones a 40px bar has no room for.
                            */}
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="font-semibold">{label}</p>
                                <p className="text-xs">
                                  {stateLabel} · {hhmm(pos.start)}&ndash;{hhmm(pos.end)}
                                  {" · "}
                                  {entry.shift === "night" ? "Night shift" : "Day shift"}
                                </p>
                                {entry.client_name ? (
                                  <p className="text-xs">{entry.client_name}</p>
                                ) : null}
                                {entry.address ? (
                                  <p className="text-xs opacity-80">{entry.address}</p>
                                ) : null}
                                <p className="mt-1 text-xs opacity-70">
                                  {entry.schedule_entry_assignments?.length ?? 0} technician
                                  {(entry.schedule_entry_assignments?.length ?? 0) === 1 ? "" : "s"}
                                  {" · click for details"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* ── Legend: the colour code, spelled out ──────────────────────── */}
        <footer className="flex shrink-0 flex-wrap items-center gap-6 border-t px-6 py-3">
          {APPOINTMENT_STATE_ORDER.filter((s) => s !== "unknown" || counts.unknown > 0).map((state) => (
            <div key={state} className="flex items-center gap-2">
              <span className={cn("size-3 rounded-sm", APPOINTMENT_STATE_STYLES[state].dot)} />
              <span className="text-sm font-medium">{APPOINTMENT_STATE_LABELS[state]}</span>
            </div>
          ))}
          <span className="text-muted-foreground ml-auto flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><TriangleAlert className="size-3.5" /> Colours mirror each appointment&apos;s status in Zoho FSM</span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {streaming
                ? "Updates live as the schedule changes"
                : `Refreshes every ${REFRESH_MS / 1000}s`}
            </span>
          </span>
        </footer>

        {/* ── One appointment, in full ──────────────────────────────────── */}
        <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="sm:max-w-lg">
            {selected ? (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        stateOf(selected) === "note"
                          ? "bg-muted-foreground"
                          : APPOINTMENT_STATE_STYLES[stateOf(selected) as AppointmentState].dot,
                      )}
                    />
                    {entryLabel(selected)}
                  </DialogTitle>
                  <DialogDescription>
                    {stateOf(selected) === "note"
                      ? "Note"
                      : APPOINTMENT_STATE_LABELS[stateOf(selected) as AppointmentState]}
                    {" · "}
                    {hhmm(zonedMinutesOfDay(selected.start_at))}
                    &ndash;
                    {hhmm(zonedMinutesOfDay(selected.end_at))}
                    {" · "}
                    {selected.shift === "night" ? "Night shift" : "Day shift"}
                  </DialogDescription>
                </DialogHeader>

                <dl className="grid gap-3 text-sm">
                  <DetailRow label="Client" value={selected.client_name} />
                  <DetailRow label="Contact" value={selected.contact_name} />
                  <DetailRow label="Address" value={selected.address} />
                  <DetailRow label="Appointment" value={selected.fsm_appointment_name} />
                  <DetailRow label="Type" value={selected.fsm_appointment_type} />
                  <DetailRow label="Notes" value={selected.notes} />

                  <div>
                    <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      Technicians ({selected.schedule_entry_assignments?.length ?? 0})
                    </dt>
                    <dd className="mt-1">
                      {selected.schedule_entry_assignments?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selected.schedule_entry_assignments.map((a) => (
                            <span
                              key={a.id}
                              className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium"
                            >
                              {a.technician_reference?.display_name ?? a.technician_fsm_id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Nobody assigned</span>
                      )}
                    </dd>
                  </div>

                  {/*
                  Shown only when it has something to say. A board that
                  reports "synced" on every appointment trains people to
                  stop reading the line that matters.
                */}
                  {selected.last_sync_error ? (
                    <div>
                      <dt className="text-destructive text-xs font-medium tracking-wide uppercase">
                        Last sync failed
                      </dt>
                      <dd className="text-destructive mt-1">{selected.last_sync_error}</dd>
                    </div>
                  ) : null}
                </dl>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/** One label and value in the appointment dialog; hidden when empty. */
function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
