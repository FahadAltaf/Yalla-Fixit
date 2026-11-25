"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, KeyRound, Search, UserRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { useTechnicianLogins } from "@/components/dashboard/shared/technician-login";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { AvailableInspectors } from "@/lib/server/amc/visits";
import { cn } from "@/lib/utils";
import { visitsService } from "@/modules/amc-contracts/visits-service";

/** As the server takes a site visit to last (SITE_VISIT_MINUTES). */
const VISIT_MINUTES = 60;
/* A filter box once the list is longer than this. */
const FILTER_FROM = 8;

type Person = { id: string; name: string; email: string | null };

/*
  "18 Nov at 10:00", in the browser's own time: the date and time fields
  above it are, so the two always read the same (16 Nov 2026; it was Dubai
  time, an hour off for someone outside the UAE).
*/
const whenLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso))
    .replace(", ", " at ");

/**
 * Who inspects a site visit (13-16 Nov 2026), found as a visit's crew is:
 * pick the date and time, press Find available inspectors, and pick from
 * the people free then (technicians first, then the rest of the team).
 * Nothing is read when the dialog opens; the button makes one request,
 * which lists only those free (AMC work, live jobs, leave, other site
 * visits). A technician with no login gets one first (their FSM email, the
 * Inspector role), with the email and password to hand over.
 *
 * `onReadyChange` says whether the chosen inspector has been checked free at
 * the time shown; a booking screen holds its save until it is. Shown as
 * "Inspector"; the record still calls it the assessor.
 */
export function AssessorPicker({
  value,
  onChange,
  people,
  scheduledAt,
  ignoreAssessmentId = null,
  onReadyChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (userId: string, name: string) => void;
  /** The team, to name the inspector already chosen before anything is searched. */
  people: Person[];
  /** The visit's time (ISO). */
  scheduledAt: string | null;
  /** The visit being edited, so its own booking is not counted as a clash. */
  ignoreAssessmentId?: string | null;
  onReadyChange?: (ready: boolean) => void;
  disabled?: boolean;
}) {
  const { createLogins, dialogs } = useTechnicianLogins();
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /* The last answer, and the time it was for: a different time needs a new search. */
  const [found, setFound] = useState<{ at: string; result: AvailableInspectors } | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  /* Names learned here (a pick, a login just made), for the card. */
  const [names, setNames] = useState<Record<string, string>>({});

  const fresh = found && scheduledAt && found.at === scheduledAt ? found.result : null;
  const freeIds = useMemo(
    () => new Set([...(fresh?.staff.map((p) => p.id) ?? []), ...(fresh?.technicians.map((t) => t.userId).filter((id): id is string => Boolean(id)) ?? [])]),
    [fresh],
  );
  const chosenFree = Boolean(value && fresh && freeIds.has(value));
  useEffect(() => {
    onReadyChange?.(chosenFree);
  }, [chosenFree, onReadyChange]);

  const find = async () => {
    if (!scheduledAt) return;
    setSearching(true);
    setFailed(null);
    setFilter("");
    try {
      const result = await visitsService.availableInspectors(scheduledAt, VISIT_MINUTES, { ignoreAssessmentId, currentUserId: value });
      setFound({ at: scheduledAt, result });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not check who is free.");
    } finally {
      setSearching(false);
    }
  };

  const pickTechnician = async (t: AvailableInspectors["technicians"][number]) => {
    if (t.userId) {
      const id = t.userId;
      setNames((n) => ({ ...n, [id]: t.name }));
      return onChange(id, t.name);
    }
    setCreating(t.fsmId);
    try {
      const made = await createLogins([{ fsmId: t.fsmId, name: t.name, email: t.email }]);
      const userId = made?.[0]?.userId;
      if (!userId) return;
      /* Free when found, and now with a login: kept in the answer so the choice reads as checked. */
      setFound((f) =>
        f ? { ...f, result: { ...f.result, technicians: f.result.technicians.map((x) => (x.fsmId === t.fsmId ? { ...x, userId, login: "ready" as const } : x)) } } : f,
      );
      setNames((n) => ({ ...n, [userId]: t.name }));
      onChange(userId, t.name);
    } finally {
      setCreating(null);
    }
  };

  const q = filter.trim().toLowerCase();
  const match = (name: string, email: string | null) => !q || name.toLowerCase().includes(q) || (email ?? "").toLowerCase().includes(q);
  const techRows = fresh?.technicians.filter((t) => match(t.name, t.email)) ?? [];
  const staffRows = fresh?.staff.filter((p) => match(p.name, p.email)) ?? [];
  const total = (fresh?.technicians.length ?? 0) + (fresh?.staff.length ?? 0);

  const chosenName = value
    ? (names[value] ?? people.find((p) => p.id === value)?.name ?? fresh?.technicians.find((t) => t.userId === value)?.name ?? "The inspector chosen")
    : null;
  const chosenStatus = !value ? null : !scheduledAt ? (
    <span className="text-muted-foreground">Pick the date and time first</span>
  ) : !fresh ? (
    <span className="text-muted-foreground">{found ? "The time changed: find again to check" : "Not checked for this time yet"}</span>
  ) : chosenFree ? (
    <span className="text-success inline-flex items-center gap-1">
      <Check className="size-3.5" aria-hidden />
      Free on {whenLabel(scheduledAt)}
    </span>
  ) : fresh.currentBusy.length ? (
    <span className="text-danger">Busy then: {fresh.currentBusy.join(" · ")}</span>
  ) : (
    <span className="text-danger">Not free on {whenLabel(scheduledAt)}: pick someone below</span>
  );

  const row = (key: string, selected: boolean, onPick: () => void, title: React.ReactNode, sub: React.ReactNode, working = false) => (
    <li key={key}>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled || creating !== null}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          selected ? "bg-brand-50" : "hover:bg-muted/50",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-brand bg-brand text-white" : "border-muted-foreground/40",
          )}
        >
          {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">{title}</span>
          <span className="text-muted-foreground block truncate text-xs">{working ? "Creating the login…" : sub}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="grid gap-2">
      {dialogs}

      {/* The choice as it stands, and whether it has been checked for this time. */}
      <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4",
            chosenFree ? "border-brand/30 bg-brand-50 text-brand" : "bg-muted/50 text-muted-foreground",
          )}
        >
          <UserRound />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", !chosenName && "text-muted-foreground font-normal")}>{chosenName ?? "No inspector chosen yet"}</span>
          {chosenStatus ? <span className="block text-xs">{chosenStatus}</span> : null}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs" role="status">
          {searching
            ? scheduledAt
              ? `Checking who is free on ${whenLabel(scheduledAt)}…`
              : "Checking…"
            : fresh && scheduledAt
              ? `${total} free on ${whenLabel(scheduledAt)}${fresh.busy ? ` · ${fresh.busy} booked then, not shown` : ""}`
              : "Find who is free at this date and time, then pick one."}
        </p>
        <SubmitButton
          type="button"
          size="sm"
          variant="outline"
          pending={searching}
          pendingLabel="Finding…"
          icon={<Search className="size-4" />}
          disabled={disabled || !scheduledAt || creating !== null}
          onClick={() => void find()}
        >
          {fresh ? "Find again" : "Find available inspectors"}
        </SubmitButton>
      </div>

      {failed && !searching ? (
        <Alert variant="danger">
          <CircleAlert aria-hidden />
          <AlertTitle>Could not check who is free</AlertTitle>
          <AlertDescription>{failed}</AlertDescription>
        </Alert>
      ) : null}

      {searching ? (
        <ul className="divide-y rounded-lg border" aria-label="Finding available inspectors" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-4 rounded-full" />
              <span className="grid flex-1 gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </span>
            </li>
          ))}
        </ul>
      ) : fresh && scheduledAt ? (
        total === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
            Nobody is free on {whenLabel(scheduledAt)}. Try another time.
          </p>
        ) : (
          <div className="grid gap-2">
            {total > FILTER_FROM ? (
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name or email" className="ps-9" aria-label="Search the free inspectors" />
              </div>
            ) : null}
            <div className="max-h-72 overflow-y-auto overscroll-contain rounded-lg border">
              {techRows.length ? (
                <>
                  <p className="bg-card text-muted-foreground sticky top-0 z-10 border-b px-3 py-1.5 text-xs font-medium">Technicians</p>
                  <ul className="divide-y">
                    {techRows.map((t) =>
                      row(
                        t.fsmId,
                        Boolean(value && t.userId === value),
                        () => void pickTechnician(t),
                        <>
                          <span className="font-medium">{t.name}</span>
                          {t.login === "none" ? (
                            <Badge variant="outline" className="border-warning/40 text-warning font-normal" title="Picking them creates a mobile login">
                              <KeyRound className="size-3" />
                              No login
                            </Badge>
                          ) : null}
                        </>,
                        t.login === "none" ? "A login is made when you pick them" : (t.email ?? "Technician"),
                        creating === t.fsmId,
                      ),
                    )}
                  </ul>
                </>
              ) : null}
              {staffRows.length ? (
                <>
                  <p className={cn("bg-card text-muted-foreground sticky top-0 z-10 border-b px-3 py-1.5 text-xs font-medium", techRows.length > 0 && "border-t")}>
                    Other staff
                  </p>
                  <ul className="divide-y">
                    {staffRows.map((p) =>
                      row(
                        p.id,
                        value === p.id,
                        () => {
                          setNames((n) => ({ ...n, [p.id]: p.name }));
                          onChange(p.id, p.name);
                        },
                        <span className="font-medium">{p.name}</span>,
                        p.email ?? "Staff",
                      ),
                    )}
                  </ul>
                </>
              ) : null}
              {!techRows.length && !staffRows.length ? (
                <p className="text-muted-foreground px-3 py-4 text-center text-sm">Nobody free matches “{filter}”.</p>
              ) : null}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
