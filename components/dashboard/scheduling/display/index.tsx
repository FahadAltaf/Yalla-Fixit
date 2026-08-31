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
  resolveAppointmentState,
  type AppointmentState,
} from "@/lib/scheduling/appointment-status";
import { cn } from "@/lib/actions/utils";

// Wall-display view of the day's schedule.
//
// Read-only and unattended: it polls rather than waiting for interaction,
// never opens a dialog, and is sized to be legible across a room. It reuses
// the same endpoints the board uses, so there is no second source of truth.
//
// Live updates are polling, not websockets: this codebase exposes no browser
// Supabase key, so a client-side realtime subscription would mean publishing
// one. A short interval against the existing authorised REST route gives the
// same practical result for a schedule that changes a few times an hour.
const REFRESH_MS = 20_000;
// Re-derive "now" often enough that a job tips into Delayed promptly and the
// current-time marker glides rather than jumps.
const CLOCK_MS = 30_000;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minutesOfDay(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
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

export default function ScheduleDisplay() {
  const [date, setDate] = useState(todayIso());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [config, setConfig] = useState<SchedulingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Keeps the first paint from flashing an empty board on every poll.
  const loadedOnce = useRef(false);

  const load = useCallback(async (targetDate: string) => {
    try {
      const day = await scheduleService.getDay(targetDate);
      setEntries(day.entries ?? []);
      setLastUpdated(Date.now());
      setFailed(false);
    } catch {
      // A failed poll must not blank a wall screen -- keep showing the last
      // good board and flag that it has gone stale.
      setFailed(true);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scheduleService.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    load(date);
    const id = setInterval(() => load(date), REFRESH_MS);
    return () => clearInterval(id);
  }, [date, load]);

  // Roll over at midnight without anyone touching the screen.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      const today = todayIso();
      setDate((current) => (current === today ? current : today));
    }, CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // The window the board spans: the union of both configured shifts, so a
  // single screen shows the whole operating day.
  const bounds = useMemo(() => {
    if (!config) return { start: 0, end: 1440 };
    const nightStart = parseHhmm(config.night_shift_start, 0);
    let nightEnd = parseHhmm(config.night_shift_end, 9 * 60);
    const dayStart = parseHhmm(config.day_shift_start, 8 * 60);
    let dayEnd = parseHhmm(config.day_shift_end, 17 * 60);
    if (nightEnd <= nightStart) nightEnd += 1440;
    if (dayEnd <= dayStart) dayEnd += 1440;
    return { start: Math.min(nightStart, dayStart), end: Math.max(nightEnd, dayEnd) };
  }, [config]);

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
        : resolveAppointmentState(entry.fsm_status, entry.start_at, now),
    [now],
  );

  const counts = useMemo(() => {
    const tally: Record<AppointmentState, number> = {
      scheduled: 0, in_progress: 0, completed: 0, delayed: 0, cancelled: 0,
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

  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const nowPct = ((nowMinutes - bounds.start) / span) * 100;
  const showNowLine = date === todayIso() && nowPct >= 0 && nowPct <= 100;

  // Greedy lane packing: an entry goes in the first lane whose last bar has
  // already finished, otherwise it opens a new one.
  const lanesFor = (rowEntries: ScheduleEntry[]) => {
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
  };

  const place = (entry: ScheduleEntry) => {
    const start = minutesOfDay(entry.start_at);
    let end = minutesOfDay(entry.end_at);
    if (end <= start) end += 1440;
    const visibleStart = Math.max(start, bounds.start);
    const visibleEnd = Math.min(end, bounds.end);
    if (visibleEnd <= visibleStart) return null;
    const left = ((visibleStart - bounds.start) / span) * 100;
    const width = Math.max(((visibleEnd - visibleStart) / span) * 100, 3);
    return { left, width: Math.min(width, 100 - left), start, end };
  };

  return (
    <div className="bg-background text-foreground flex h-dvh w-full flex-col overflow-hidden">
      {/* ── Header: identity, liveness, and the day at a glance ───────── */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Image src={CompanyLogo} alt="" height={44} className="h-15 w-auto object-contain" priority unoptimized />
          {/* <div>
            <h1 className="text-2xl leading-tight font-semibold">Daily Schedule</h1>
            <p className="text-muted-foreground text-sm">
              {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long", day: "2-digit", month: "long", year: "numeric",
              })}
            </p>
          </div> */}
        </div>

        <div className="flex items-center gap-6">
          {APPOINTMENT_STATE_ORDER.filter((s) => s !== "cancelled" || counts.cancelled > 0).map((state) => (
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

          <div className="border-l pl-6">
            <p className="text-muted-foreground flex items-center gap-1.5 text-[0.7rem] font-medium tracking-wider uppercase">
              <Users className="size-3.5" /> Technicians
            </p>
            <p className="text-4xl font-bold tabular-nums">{String(rows.length).padStart(2, "0")}</p>
          </div>

          {/* Liveness is stated in words as well as colour, and says when it
              last actually succeeded -- a silent stale board is the worst
              failure mode for an unattended screen. */}
          {/* <div className="flex items-center gap-2 border-l pl-6">
            <span
              className={cn(
                "size-2.5 rounded-full",
                failed ? "bg-red-600" : "animate-pulse bg-emerald-500",
              )}
            />
            <div className="leading-tight">
              <p className="text-sm font-medium">{failed ? "Reconnecting" : "Live"}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : "Loading..."}
              </p>
            </div>
          </div> */}
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
                {hourMarks.map((m) => (
                  <div
                    key={m}
                    className="text-muted-foreground absolute inset-y-0 flex items-center border-l px-2 text-xs tabular-nums"
                    style={{ left: `${((m - bounds.start) / span) * 100}%` }}
                  >
                    {hhmm(m)}
                  </div>
                ))}
                <div className="py-2 text-xs leading-none">&nbsp;</div>
              </div>
            </div>

            {rows.map((row) => {
              const { laneOf, laneCount } = lanesFor(row.entries);
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

                    {showNowLine && (
                      <div className="absolute inset-y-0 z-10 w-0.5 bg-red-500" style={{ left: `${nowPct}%` }} />
                    )}

                    <div
                      className="relative"
                      style={{ minHeight: `${laneCount * 3 + 0.25}rem` }}
                    >
                      {row.entries.map((entry) => {
                        const pos = place(entry);
                        if (!pos) return null;
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
                          <div
                            key={entry.id}
                            className={cn(
                              "absolute flex h-10 items-center gap-2 overflow-hidden rounded-md px-2.5 ring-1",
                              styles.bar,
                            )}
                            style={{
                              left: `${pos.left}%`,
                              width: `${pos.width}%`,
                              top: `${(laneOf.get(entry.id) ?? 0) * 3}rem`,
                            }}
                            title={`${label} · ${stateLabel} · ${hhmm(pos.start)}–${hhmm(pos.end)}`}
                          >
                            <span className="truncate text-sm font-semibold">{label}</span>
                            <span className="ml-auto shrink-0 text-xs font-medium tabular-nums opacity-90">
                              {hhmm(pos.start)}
                            </span>
                          </div>
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
        {APPOINTMENT_STATE_ORDER.map((state) => (
          <div key={state} className="flex items-center gap-2">
            <span className={cn("size-3 rounded-sm", APPOINTMENT_STATE_STYLES[state].dot)} />
            <span className="text-sm font-medium">{APPOINTMENT_STATE_LABELS[state]}</span>
          </div>
        ))}
        <span className="text-muted-foreground ml-auto flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5"><TriangleAlert className="size-3.5" /> Delayed = start time passed, not started</span>
          <span className="flex items-center gap-1.5"><Clock className="size-3.5" /> Refreshes every {REFRESH_MS / 1000}s</span>
        </span>
      </footer>
    </div>
  );
}
