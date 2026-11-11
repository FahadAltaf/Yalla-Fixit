"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usersService } from "@/modules/users/services/users-service";
import { visitsService } from "@/modules/amc-contracts/visits-service";

/**
 * The two people pickers AMC operations share: a portal user (who
 * collected the cash, who hears about an unanswered client) and an FSM
 * technician (who found the additional work). Each list is fetched once
 * per page load and shared by every picker on it.
 */

const NONE = "__none";

type Person = { id: string; name: string; detail: string | null };
type ListState = { list: Person[]; loading: boolean; error: string | null };

/* One request per list, whichever dialog asks first; a failure is not kept, so the next open tries again. */
function cached(load: () => Promise<Person[]>) {
  let pending: Promise<Person[]> | null = null;
  return () => {
    pending ??= load().catch((e) => {
      pending = null;
      throw e;
    });
    return pending;
  };
}

/* Every active colleague (the same directory the Todos assignees come from). */
const loadStaff = cached(async () =>
  (await usersService.getUsers())
    .filter((u) => u.is_active !== false)
    .map((u) => ({ id: u.id, name: u.full_name?.trim() || u.email || "User", detail: u.full_name?.trim() && u.email ? u.email : null }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

/* The FSM technicians (AMC -> Technicians); needs AMC Technicians (View). */
const loadTechnicians = cached(async () =>
  (await visitsService.technicians()).technicians
    .filter((t) => t.active)
    .map((t) => ({ id: t.fsmId, name: t.name, detail: t.role })),
);

function usePeople(load: () => Promise<Person[]>): ListState {
  const [state, setState] = useState<ListState>({ list: [], loading: true, error: null });
  useEffect(() => {
    let stale = false;
    load().then(
      (list) => !stale && setState({ list, loading: false, error: null }),
      (e) => !stale && setState({ list: [], loading: false, error: e instanceof Error ? e.message : "Could not load the list." }),
    );
    return () => {
      stale = true;
    };
  }, [load]);
  return state;
}

export const useStaff = () => usePeople(loadStaff);
export const useTechnicians = () => usePeople(loadTechnicians);

function PersonSelect({
  id,
  value,
  onChange,
  state,
  noneLabel,
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  state: ListState;
  noneLabel: string;
  disabled?: boolean;
}) {
  /* Someone already chosen who is no longer listed (inactive, left) still shows. */
  const missing = value && !state.list.some((p) => p.id === value) ? value : null;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled || state.loading}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={state.loading ? "Loading…" : noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {missing ? <SelectItem value={missing}>{state.loading ? "Loading…" : `${missing} (not listed)`}</SelectItem> : null}
        {state.list.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="truncate">
              {p.name}
              {p.detail ? <span className="text-muted-foreground ml-1 text-xs">{p.detail}</span> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A portal user, by profile id. */
export function StaffSelect(props: { id?: string; value: string | null; onChange: (id: string | null) => void; noneLabel?: string; disabled?: boolean }) {
  const state = useStaff();
  return (
    <>
      <PersonSelect {...props} state={state} noneLabel={props.noneLabel ?? "Nobody"} />
      {state.error ? <p className="text-warning text-xs">Could not load the staff list: {state.error}</p> : null}
    </>
  );
}

/**
 * An FSM technician, by FSM resource id. Without access to the technician
 * directory the id is typed instead, as before.
 */
export function TechnicianSelect(props: { id?: string; value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const state = useTechnicians();
  if (state.error) {
    return (
      <Input
        id={props.id}
        maxLength={40}
        placeholder="FSM ID"
        disabled={props.disabled}
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value.trim() ? e.target.value : null)}
      />
    );
  }
  return <PersonSelect {...props} state={state} noneLabel="Not set" />;
}

/** A technician's name where the directory is readable; the id otherwise. */
export function useTechnicianName() {
  const { list } = useTechnicians();
  return (id: string | null | undefined) => (id ? (list.find((t) => t.id === id)?.name ?? id) : null);
}
