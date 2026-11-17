"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTechnicianAccounts, useTechnicianLogins } from "@/components/dashboard/shared/technician-login";
import MultipleSelector, { type Option } from "@/components/ui/multiselect";
import {
  usersService,
  type AssignableUser,
} from "@/modules/users/services/users-service";

/**
 * The staff anybody can be assigned to a job or a visit: everyone active.
 *
 * Shared so the round's picker and the visit's dropdown offer the same
 * people, and each screen fetches the list once, when it opens.
 */
export function useActiveStaff(): {
  users: AssignableUser[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Set on unmount, so a reply that arrives late writes nothing. */
  const [gone] = useState({ value: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await usersService.getAssignableUsers();
      if (!gone.value) setUsers(rows.filter((row) => row.is_active !== false));
    } catch (err) {
      if (!gone.value) {
        // An empty picker was the only sign of a failed fetch, so "nobody
        // to assign" and "the staff list broke" looked identical.
        setUsers([]);
        setError(
          err instanceof Error ? err.message : "Could not load the staff list",
        );
      }
    } finally {
      if (!gone.value) setLoading(false);
    }
  }, [gone]);

  useEffect(() => {
    gone.value = false;
    void load();
    return () => {
      gone.value = true;
    };
  }, [load, gone]);

  return { users, loading, error, reload: load };
}

/**
 * Who is going, on a screen that books a trip.
 *
 * Booking a de-snag round used to ask for a date and nobody: the round
 * quietly inherited whoever led the original inspection, so a coordinator
 * booked a slot and then went looking for the screen that says who
 * attends. It is asked here instead, opened on the people already on the
 * job so the ordinary case is a glance and a Confirm.
 *
 * Inspectors come from the technicians (13 Nov 2026), the same people the
 * AMC crew lists offer. A technician without a login is still listed;
 * picking one creates their login first (their Zoho FSM email, the
 * Inspector role) and shows the email and password to hand over, then
 * puts them on. Inspector accounts that are not technicians stay listed
 * underneath, so nobody who could be assigned before disappears.
 *
 * The same control on the job's Setup tab and in every dialog, so a name
 * is picked and a name is removed the same way wherever it is done.
 *
 * `names` labels somebody who is already selected while the list is still
 * loading, so a seeded picker never paints raw ids. `busy` (user id ->
 * job code) greys out who is booked elsewhere that day.
 */
const NEEDS_LOGIN = "tech:";

export function InspectorPicker({
  value,
  onChange,
  names,
  disabled,
  placeholder = "Assign inspectors",
  busy,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Known id → name, for the selection this opened with. */
  names?: Record<string, string>;
  disabled?: boolean;
  placeholder?: string;
  /** Booked elsewhere that day: user id → the job it is booked on. */
  busy?: Record<string, string>;
}) {
  /*
    Loaded on mount, which for a picker inside a dialog is the moment the
    dialog opens -- the list is never fetched for a dialog nobody opened.
  */
  const { list, error, reload } = useTechnicianAccounts();
  const { createLogins, dialogs } = useTechnicianLogins();
  const [creating, setCreating] = useState(false);
  /* Bumped to remount the control closed: it keeps its list open while the pointer is over it, even once focus has gone. */
  const [closeKey, setCloseKey] = useState(0);
  /* Names of logins made here, until the reloaded list has them. */
  const [madeNames, setMadeNames] = useState<Record<string, string>>({});
  /* The selection as it is now, for a login that finishes after it changed. */
  const current = useRef(value);
  useEffect(() => {
    current.current = value;
  }, [value]);

  const technicians = list?.technicians ?? [];
  const others = list?.inspectors ?? [];

  const nameOf = (id: string) =>
    technicians.find((t) => t.userId === id)?.name ??
    others.find((u) => u.id === id)?.name ??
    madeNames[id] ??
    names?.[id] ??
    (list ? "Someone no longer listed" : "Loading…");

  const busyNote = (id: string) => {
    const code = busy?.[id];
    return code && !value.includes(id) ? code : null;
  };

  const options: Option[] = [
    ...technicians.map((t): Option => {
      if (t.login === "none") {
        return { value: NEEDS_LOGIN + t.fsmId, label: `${t.name} · no login yet`, group: "Technicians" };
      }
      if (t.login === "inactive") {
        return { value: t.userId ?? NEEDS_LOGIN + t.fsmId, label: `${t.name} · login switched off`, group: "Technicians", disable: true };
      }
      if (!t.canInspect) {
        return { value: t.userId!, label: `${t.name} · no Snagging access`, group: "Technicians", disable: !value.includes(t.userId!) };
      }
      const code = busyNote(t.userId!);
      return { value: t.userId!, label: t.name + (code ? ` · busy (${code})` : ""), group: "Technicians", disable: Boolean(code) };
    }),
    ...others.map((u): Option => {
      const code = busyNote(u.id);
      return { value: u.id, label: u.name + (code ? ` · busy (${code})` : ""), group: "Other inspectors", disable: Boolean(code) };
    }),
  ];

  const pick = (picked: Option[]) => {
    const ids = picked.map((o) => o.value);
    const needLogin = ids.filter((id) => id.startsWith(NEEDS_LOGIN)).map((id) => id.slice(NEEDS_LOGIN.length));
    const ready = ids.filter((id) => !id.startsWith(NEEDS_LOGIN));
    onChange(ready);
    if (!needLogin.length) return;
    const targets = technicians.filter((t) => needLogin.includes(t.fsmId));
    /* Close the list, or it stays open over the question. */
    setCloseKey((k) => k + 1);
    setCreating(true);
    void createLogins(targets.map((t) => ({ fsmId: t.fsmId, name: t.name, email: t.email })))
      .then((made) => {
        if (!made?.length) return;
        setMadeNames((prev) => ({ ...prev, ...Object.fromEntries(made.map((r) => [r.userId, r.name])) }));
        onChange([...new Set([...current.current, ...made.map((r) => r.userId)])]);
        void reload();
      })
      .finally(() => setCreating(false));
  };

  return (
    <>
      {dialogs}
      <MultipleSelector
        key={closeKey}
        value={value.map((id) => ({ value: id, label: nameOf(id) }))}
        onChange={pick}
        options={options}
        groupBy="group"
        placeholder={creating ? "Creating login…" : placeholder}
        hidePlaceholderWhenSelected
        disabled={disabled || creating}
        /*
          The shared Command root ships `size-full`, which is right in a
          popover and wrong inside a form row: as a grid item's child its
          height resolves against a row still being measured.
        */
        commandProps={{ className: "h-auto" }}
        emptyIndicator={
          <p className="text-muted-foreground py-2 text-center text-sm">
            {list ? "No one else to assign." : "Loading technicians…"}
          </p>
        }
      />
      {error ? (
        <p className="text-destructive mt-1 text-xs">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : null}
    </>
  );
}
