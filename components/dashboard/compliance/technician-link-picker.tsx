"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { complianceService, type TechnicianOption } from "@/modules/compliance";

/**
 * Link to the FSM technician (FRD D3, D11). One technician per employee;
 * the list says who is already linked. A linked employee's status follows
 * FSM deactivation.
 */
export function TechnicianLinkPicker({
  value,
  displayName,
  onChange,
  disabled,
}: {
  value: string | null;
  displayName: string | null;
  onChange: (fsmResourceId: string | null, displayName: string | null) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<TechnicianOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (disabled || value) return;
    const handle = setTimeout(() => {
      setLoading(true);
      complianceService
        .technicians(search)
        .then(setOptions)
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [search, disabled, value]);

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{displayName ?? value}</span>
        {!disabled ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null, null)}>
            Unlink
          </Button>
        ) : null}
      </div>
    );
  }

  if (disabled) return <span className="text-muted-foreground text-sm">Not linked</span>;

  return (
    <div className="flex flex-col gap-2">
      <Input id="compliance-technician-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search FSM technicians" />
      <ul className="max-h-48 divide-y overflow-auto rounded-md border text-sm">
        {loading && !options.length ? <li className="text-muted-foreground px-3 py-2">Loading…</li> : null}
        {!loading && !options.length ? <li className="text-muted-foreground px-3 py-2">No technicians match</li> : null}
        {options.map((t) => (
          <li key={t.fsm_resource_id}>
            <button
              type="button"
              className="hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left disabled:opacity-50"
              onClick={() => onChange(t.fsm_resource_id, t.display_name)}
              disabled={Boolean(t.linked_to)}
            >
              <span>{t.display_name}</span>
              <span className="text-muted-foreground text-xs">{t.linked_to ? `Linked to ${t.linked_to}` : t.is_active ? "Active in FSM" : "Inactive in FSM"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
