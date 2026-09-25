"use client";

import { useCallback, useEffect, useState } from "react";

import MultipleSelector from "@/components/ui/multiselect";
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
 * The same control the job's Setup tab assigns with, so a name is picked
 * and a name is removed the same way wherever it is done.
 *
 * `names` labels somebody who is already selected while the staff list is
 * still loading, so a seeded picker never paints raw ids.
 */
export function InspectorPicker({
  value,
  onChange,
  names,
  disabled,
  placeholder = "Assign inspectors",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Known id → name, for the selection this opened with. */
  names?: Record<string, string>;
  disabled?: boolean;
  placeholder?: string;
}) {
  /*
    Loaded on mount, which for a picker inside a dialog is the moment the
    dialog opens -- the list is never fetched for a dialog nobody opened.
  */
  const { users, error } = useActiveStaff();

  const labelFor = (id: string) => {
    const user = users.find((row) => row.id === id);
    return (user?.full_name || user?.email) ?? names?.[id] ?? "Loading…";
  };

  return (
    <>
      <MultipleSelector
        value={value.map((id) => ({ value: id, label: labelFor(id) }))}
        onChange={(picked) => onChange(picked.map((option) => option.value))}
        options={users.map((user) => ({
          value: user.id,
          label: (user.full_name || user.email) ?? user.id,
        }))}
        placeholder={placeholder}
        hidePlaceholderWhenSelected
        disabled={disabled}
        /*
          The shared Command root ships `size-full`, which is right in a
          popover and wrong inside a form row -- see the same note on the
          Setup tab's picker.
        */
        commandProps={{ className: "h-auto" }}
        emptyIndicator={
          <p className="text-muted-foreground py-2 text-center text-sm">
            No one else to assign.
          </p>
        }
      />
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </>
  );
}
