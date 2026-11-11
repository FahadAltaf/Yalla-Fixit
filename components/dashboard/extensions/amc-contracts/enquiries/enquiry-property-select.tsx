"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  amcContractsService,
  type ClientAddress,
} from "@/modules/amc-contracts/amc-contracts-service";

import { AddressDialog, useAddressFormAccess } from "../address-dialog";

const ADD = "__add";

/**
 * The client's properties to pick from, as New quotation and New enquiry
 * list them: the portal's, then the client's addresses in Zoho FSM the
 * portal has not used yet (picking one makes its portal record; FSM is only
 * read), and "Add a new property" at the end when the caller can add one.
 *
 * With `requireComplete` (a site visit), an address saved with only a few
 * details (from an enquiry, or from Zoho FSM) is completed before it is
 * used: picking it opens the address form, with its pin on the map, and it
 * is chosen once the missing fields are saved.
 */
export function EnquiryPropertySelect({
  customerId,
  value,
  onChange,
  onAddNew,
  refreshKey = 0,
  clientName = "the client",
  requireComplete = false,
  onCompleteChange,
}: {
  customerId: string;
  value: string | null;
  onChange: (propertyId: string | null) => void;
  /** Opens the new-property form; without it there is no Add option. */
  onAddNew?: () => void;
  /** Bumped after a property is added, so the list reads it again. */
  refreshKey?: number;
  /** Named in the completion form. */
  clientName?: string;
  /** Only a complete address (unit, project, type, bedrooms, built-up area) can be chosen. */
  requireComplete?: boolean;
  /** Told whether the address chosen is complete, so the caller can hold its save until it is. */
  onCompleteChange?: (complete: boolean) => void;
}) {
  const addressForm = useAddressFormAccess();
  /* An address picked that still lacks required fields: its completion form is open. */
  const [completing, setCompleting] = useState<{ id: string; missing: string[] } | null>(null);
  /* Chosen without the form (no Snagging access): what it still lacks, said under the list. */
  const [stillMissing, setStillMissing] = useState<string[]>([]);
  const [state, setState] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
    rows: ClientAddress[];
    fsmError: string | null;
  }>({
    key: "",
    status: "loading",
    rows: [],
    fsmError: null,
  });
  const [linking, setLinking] = useState(false);
  const key = `${customerId}|${refreshKey}`;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    amcContractsService.clientAddresses(customerId).then(
      ({ addresses, fsmError }) =>
        !stale && setState({ key, status: "ready", rows: addresses, fsmError }),
      () =>
        !stale && setState({ key, status: "error", rows: [], fsmError: null }),
    );
    return () => {
      stale = true;
    };
  }, [customerId, key, attempt]);

  const status = state.key === key ? state.status : "loading";
  const rows = state.key === key ? state.rows : [];
  /* The address already chosen (say, the enquiry's) can be the incomplete one. */
  const chosen = rows.find((r) => r.id === value) ?? null;
  const chosenMissing = requireComplete && chosen ? (chosen.missing ?? []) : [];
  const complete = !requireComplete || (status === "ready" && Boolean(chosen) && chosenMissing.length === 0);
  useEffect(() => {
    onCompleteChange?.(complete);
  }, [complete, onCompleteChange]);

  /* Use the address, or first complete it when the caller needs it complete. */
  function choose(id: string, missing: string[]) {
    if (requireComplete && missing.length > 0) {
      if (addressForm) return setCompleting({ id, missing });
      setStillMissing(missing);
    } else {
      setStillMissing([]);
    }
    onChange(id);
  }

  async function pick(next: string) {
    if (next === ADD) return onAddNew?.();
    const row = rows.find((r) => r.id === next);
    if (!row) return onChange(null);
    if (row.source === "portal") return choose(row.id, row.missing ?? []);
    setLinking(true);
    try {
      const { property, missing = [] } = await amcContractsService.openFsmAddress(
        customerId,
        row.fsmAddressId ?? row.id.replace(/^fsm:/, ""),
      );
      setState((s) => ({
        ...s,
        rows: s.rows.map((r) =>
          r.id === row.id ? { ...r, id: property.id, source: "portal", missing } : r,
        ),
      }));
      choose(property.id, missing);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not use that address",
      );
    } finally {
      setLinking(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="border-input text-muted-foreground flex h-8 w-full items-center gap-2 rounded-[12px] border px-3 text-sm">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        <span className="truncate">Loading the client&apos;s properties…</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="border-input flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-1.5 text-sm">
        <span className="text-muted-foreground">
          Could not load the client&apos;s properties.
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAttempt((a) => a + 1)}
        >
          Try again
        </Button>
      </div>
    );
  }
  /* Nothing on file: straight to adding one, rather than an empty, disabled list. */
  if (rows.length === 0) {
    return onAddNew ? (
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start"
        onClick={onAddNew}
      >
        <Plus className="size-4" />
        No property on file yet. Add one
      </Button>
    ) : (
      <p className="text-muted-foreground text-sm">
        No property on file for this client yet.
      </p>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Select
        value={value ?? ""}
        onValueChange={(v) => void pick(v)}
        disabled={linking}
      >
        <SelectTrigger className="w-full" aria-label="Property">
          <SelectValue
            placeholder={linking ? "Adding the address…" : "Choose a property"}
          />
        </SelectTrigger>
        <SelectContent>
          {rows.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              <span className="truncate">
                {r.label}
                {r.source === "fsm" ? (
                  <span className="text-muted-foreground"> · Zoho FSM</span>
                ) : null}
              </span>
              {requireComplete && (r.source === "fsm" || (r.missing?.length ?? 0) > 0) ? (
                <Badge variant="secondary" className="bg-warning/10 text-warning ml-auto h-5 shrink-0 border-0 px-1.5 text-[11px] font-medium">
                  Details missing
                </Badge>
              ) : null}
            </SelectItem>
          ))}
          {onAddNew ? (
            <>
              <SelectSeparator />
              <SelectItem value={ADD} className="text-brand">
                <Plus className="size-4" />
                Add a new property
              </SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>
      {state.fsmError ? (
        <p className="text-warning text-xs">
          Zoho FSM could not be read, so the client&apos;s addresses there are
          not listed.
        </p>
      ) : null}
      {chosenMissing.length > 0 && !completing ? (
        <div className="border-warning/30 bg-warning/5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-2">
          <p className="text-warning text-xs">This address is missing {chosenMissing.join(", ").toLowerCase()}.</p>
          {addressForm && chosen ? (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setCompleting({ id: chosen.id, missing: chosenMissing })}>
              Complete the address
            </Button>
          ) : null}
        </div>
      ) : stillMissing.length > 0 ? (
        <p className="text-warning text-xs">
          This address is missing {stillMissing.join(", ").toLowerCase()}. Someone with Snagging access can complete it on the Clients page.
        </p>
      ) : null}
      {completing ? (
        <AddressDialog
          open
          onOpenChange={(open) => !open && setCompleting(null)}
          clientId={customerId}
          clientName={clientName}
          propertyId={completing.id}
          missing={completing.missing}
          onSaved={(id) => {
            setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, missing: [] } : r)) }));
            setCompleting(null);
            setStillMissing([]);
            onChange(id);
            setAttempt((a) => a + 1);
          }}
        />
      ) : null}
    </div>
  );
}
