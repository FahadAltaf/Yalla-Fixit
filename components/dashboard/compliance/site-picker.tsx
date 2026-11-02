"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { complianceService, type SiteClientOption, type SitePropertyOption } from "@/modules/compliance";

export type SiteValue = { site_client_id: string | null; site_property_id: string | null; client_name: string | null; property_label: string | null };

/**
 * Current site = an FSM client plus optional project location (FRD D4).
 * Picking a client that only exists in FSM creates its portal row, the
 * same way the snagging client picker does.
 */
export function SitePicker({ value, onChange, disabled }: { value: SiteValue; onChange: (v: SiteValue) => void; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<SiteClientOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [properties, setProperties] = useState<SitePropertyOption[]>([]);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!value.site_client_id) {
      setProperties([]);
      return;
    }
    let alive = true;
    complianceService
      .siteProperties(value.site_client_id)
      .then((p) => alive && setProperties(p))
      .catch(() => alive && setProperties([]));
    return () => {
      alive = false;
    };
  }, [value.site_client_id]);

  const runSearch = async () => {
    setSearching(true);
    try {
      const result = await complianceService.siteClients(search, 0, 20);
      setClients(result.data);
      if (!result.data.length) toast.message("No clients match");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Client search failed");
    } finally {
      setSearching(false);
    }
  };

  const pickClient = async (option: SiteClientOption) => {
    setResolving(true);
    try {
      const resolved = await complianceService.resolveSite({ id: option.id || null, fsm_contact_id: option.fsm_contact_id }, null);
      onChange({ site_client_id: resolved.site_client_id, site_property_id: null, client_name: resolved.client_name, property_label: null });
      setClients([]);
      setSearch("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not select that client");
    } finally {
      setResolving(false);
    }
  };

  const pickProperty = async (choice: string) => {
    if (!value.site_client_id) return;
    if (choice === "none") {
      onChange({ ...value, site_property_id: null, property_label: null });
      return;
    }
    setResolving(true);
    try {
      const resolved = await complianceService.resolveSite({ id: value.site_client_id }, choice);
      const label = properties.find((p) => p.id === choice)?.label ?? null;
      onChange({ ...value, site_property_id: resolved.site_property_id, property_label: label });
      if (choice.startsWith("fsm:")) setProperties(await complianceService.siteProperties(value.site_client_id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not select that location");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {value.site_client_id ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{value.client_name ?? "Selected client"}</span>
          {!disabled ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ site_client_id: null, site_property_id: null, client_name: null, property_label: null })}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">Unassigned</span>
      )}

      {!disabled ? (
        <div className="flex gap-2">
          <Input
            id="compliance-site-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search FSM clients"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={() => void runSearch()} disabled={searching || resolving}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      ) : null}

      {clients.length ? (
        <ul className="max-h-48 divide-y overflow-auto rounded-md border text-sm">
          {clients.map((c) => (
            <li key={c.fsm_contact_id ?? c.id}>
              <button type="button" className="hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => void pickClient(c)} disabled={resolving}>
                <span>
                  {c.name}
                  {c.company ? <span className="text-muted-foreground"> · {c.company}</span> : null}
                </span>
                <span className="text-muted-foreground text-xs">{c.source === "fsm" ? "FSM" : "Portal"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {value.site_client_id && !disabled ? (
        <Select value={value.site_property_id ?? "none"} onValueChange={(v) => void pickProperty(v)} disabled={resolving}>
          <SelectTrigger id="compliance-site-property">
            <SelectValue placeholder="Project location (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No specific project location</SelectItem>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
                {p.id.startsWith("fsm:") ? " (FSM)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : value.property_label ? (
        <span className="text-muted-foreground text-sm">{value.property_label}</span>
      ) : null}
    </div>
  );
}
