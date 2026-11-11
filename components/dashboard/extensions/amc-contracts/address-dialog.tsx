"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AddressForm, FormBlock, FormField } from "@/components/dashboard/snagging/client-addresses-dialog";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { UNIT_TYPE_CATEGORY, UNIT_TYPE_LABELS, UNIT_TYPES } from "@/lib/amc/client-profile";
import { hasResourceAction } from "@/lib/role-permissions";
import { amcContractsService, type PropertyRecord } from "@/modules/amc-contracts/amc-contracts-service";
import { snaggingService } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingProperty, type SnaggingPropertyType } from "@/types/types";

type UnitType = (typeof UNIT_TYPES)[number];
type Occupancy = "owner" | "tenant" | "vacant";

/** The commercial kinds AMC prices by (Snagging only knows "commercial"). */
const COMMERCIAL_TYPES = UNIT_TYPES.filter((u) => UNIT_TYPE_CATEGORY[u] !== "residential");

/**
 * Whether the address form can be used: it saves through Snagging's
 * properties (and from there to Zoho FSM), which needs Snagging (Create).
 * Without it the AMC property form is used instead.
 */
export function useAddressFormAccess(): boolean {
  const { userProfile } = useAuth();
  return hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE);
}

/** AMC's finer unit type as Snagging's four. */
function snaggingType(unitType: string | null | undefined, category: string | null | undefined): SnaggingPropertyType | undefined {
  if (unitType === "villa" || unitType === "apartment" || unitType === "townhouse") return unitType;
  if (unitType || category === "commercial") return "commercial";
  return undefined;
}

type Defaults = { unitType?: string | null; propertyCategory?: string | null; community?: string | null };

/**
 * An AMC client's address, on the same form as Snagging's Clients page (unit,
 * building, community, type, size, the pin on the map and the paperwork), so
 * an address is entered one way everywhere and goes to Zoho FSM the same way.
 * It is held to what a quotation needs (unit, project, type, bedrooms,
 * built-up area). What the maintenance contract needs beyond that (the kind
 * of commercial unit, floor, street, city, who occupies it, zones and access)
 * is asked in a block of its own on the same form.
 *
 * With `propertyId` it completes an address already on file: one picked for a
 * site visit that was saved with only a few details (from an enquiry, or
 * from Zoho FSM).
 */
export function AddressDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  defaults,
  propertyId = null,
  missing = [],
  editing = false,
  full = false,
  parentOptions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** From the enquiry: what the client said about the property. */
  defaults?: Defaults;
  /** An address on file to complete, rather than a new one. */
  propertyId?: string | null;
  /** What that address lacks, said in the dialog. */
  missing?: string[];
  /**
   * Edits the address on file (with `propertyId`) rather than completing it:
   * nothing beyond the unit reference is required, and the AMC block also
   * asks what the AMC property form asked (address line, unit no., floors,
   * the building it is part of, notes), so this one form replaces that one.
   */
  editing?: boolean;
  /**
   * A new address on the full form, as the client page adds one: every AMC
   * field (and the building it is part of), and only the reference required.
   */
  full?: boolean;
  /** The client's properties a new one can be part of. */
  parentOptions?: Array<{ id: string; label: string }>;
  /** Told about the property once it and its AMC details are saved. */
  onSaved: (propertyId: string) => void;
}) {
  const completing = Boolean(propertyId) && !editing;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{editing ? `${clientName} · address` : completing ? "Complete the address" : `Add an address for ${clientName}`}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changes the address for AMC and Snagging alike, as on the Clients page. Signed contracts keep their own copy."
              : completing
              ? `This address is missing ${missing.length ? missing.join(", ").toLowerCase() : "some details"}. Fill them in to use it; they are saved to ${clientName}'s address for every job and visit after.`
              : "As on the Clients page: the unit, what it is and its pin on the map. Saved to the client, and to Zoho FSM when it is connected."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">
          {open ? (
            propertyId ? (
              <CompleteBody clientId={clientId} propertyId={propertyId} editing={editing} onCancel={() => onOpenChange(false)} onSaved={onSaved} />
            ) : (
              <AddressBody clientId={clientId} defaults={defaults} full={full} parentOptions={parentOptions} onCancel={() => onOpenChange(false)} onSaved={onSaved} />
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Reads the address on file (Snagging's record, and what AMC keeps about it) before showing the form. */
function CompleteBody({
  clientId,
  propertyId,
  editing,
  onCancel,
  onSaved,
}: {
  clientId: string;
  propertyId: string;
  editing: boolean;
  onCancel: () => void;
  onSaved: (propertyId: string) => void;
}) {
  const [state, setState] = useState<
    { address: SnaggingProperty; amc: PropertyRecord | null; others: PropertyRecord[] } | { error: string } | null
  >(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    /* The one address and its AMC record; the client's other properties only when editing ("part of"). Not the client's whole list and Zoho FSM. */
    Promise.all([
      snaggingService.getClientAddress(propertyId),
      amcContractsService.propertyCard(propertyId).then(
        ({ property }) => property,
        () => null,
      ),
      editing ? amcContractsService.customerProperties(clientId).then(({ properties }) => properties) : Promise.resolve([] as PropertyRecord[]),
    ]).then(
      ([address, amc, properties]) => {
        if (stale) return;
        setState(
          address && address.client_id === clientId
            ? { address, amc, others: properties.filter((p) => p.id !== propertyId) }
            : { error: "That address could not be found on the client." },
        );
      },
      (e) => !stale && setState({ error: e instanceof Error ? e.message : "Could not load the address." }),
    );
    return () => {
      stale = true;
    };
  }, [clientId, propertyId, editing, attempt]);

  if (!state) {
    return (
      <div className="space-y-4 px-6 py-4" aria-label="Loading the address">
        <Skeleton className="h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }
  if ("error" in state) {
    return (
      <div className="px-6 py-4">
        <ErrorState title="Could not load the address" message={state.error} onRetry={() => setAttempt((a) => a + 1)} />
      </div>
    );
  }
  /* "Part of" offers the client's other properties, not the ones already under this one. */
  const parentOptions = editing ? state.others.filter((p) => p.parentPropertyId !== propertyId).map((p) => ({ id: p.id, label: p.label })) : undefined;
  return (
    <AddressBody
      clientId={clientId}
      address={state.address}
      amc={state.amc}
      full={editing}
      parentOptions={parentOptions}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}

function AddressBody({
  clientId,
  address = null,
  amc = null,
  defaults,
  full = false,
  parentOptions,
  onCancel,
  onSaved,
}: {
  clientId: string;
  address?: SnaggingProperty | null;
  amc?: PropertyRecord | null;
  defaults?: Defaults;
  full?: boolean;
  parentOptions?: Array<{ id: string; label: string }>;
  onCancel: () => void;
  onSaved: (propertyId: string) => void;
}) {
  const startingUnit = amc?.unitType ?? defaults?.unitType ?? null;
  const startingCommercial = startingUnit && COMMERCIAL_TYPES.includes(startingUnit as UnitType) ? (startingUnit as UnitType) : null;
  const [commercialType, setCommercialType] = useState<UnitType | null>(startingCommercial);
  const [floor, setFloor] = useState(amc?.floor ?? "");
  const [street, setStreet] = useState(amc?.street ?? "");
  const [city, setCity] = useState(amc?.city ?? "");
  const [occupancy, setOccupancy] = useState<Occupancy | null>(
    amc?.occupancy === "owner" || amc?.occupancy === "tenant" || amc?.occupancy === "vacant" ? amc.occupancy : null,
  );
  const [zones, setZones] = useState((amc?.zones ?? []).join(", "));
  const [access, setAccess] = useState(amc?.accessConstraints ?? "");
  /* The rest of what the AMC property form asked; on a full form only (a property edited, or added from the client). */
  const [addressLine, setAddressLine] = useState(amc?.address ?? "");
  const [unitNo, setUnitNo] = useState(amc?.unitNo ?? "");
  const [floorsCount, setFloorsCount] = useState(amc?.floorsCount != null ? String(amc.floorsCount) : "");
  const [parentId, setParentId] = useState<string | null>(amc?.parentPropertyId ?? null);
  const [notes, setNotes] = useState(amc?.notes ?? "");

  return (
    <AddressForm
      clientId={clientId}
      address={address}
      requireComplete={!full}
      defaults={{
        community: defaults?.community ?? null,
        property_type: snaggingType(defaults?.unitType ?? amc?.unitType, defaults?.propertyCategory ?? amc?.propertyCategory),
      }}
      onCancel={onCancel}
      onSaved={async (saved) => {
        const commercial = saved.property_type === "commercial";
        try {
          await amcContractsService.updatePropertyDetails(saved.id, {
            unitType: commercial ? commercialType : saved.property_type,
            propertyCategory: commercial ? "commercial" : "residential",
            occupancy,
            floor: floor.trim() || null,
            street: street.trim() || null,
            city: city.trim() || null,
            zones: commercial ? zones.split(",").map((z) => z.trim()).filter(Boolean) : [],
            accessConstraints: access.trim() || null,
            ...(full
              ? {
                  address: addressLine.trim() || null,
                  unitNo: unitNo.trim() || null,
                  notes: notes.trim() || null,
                  parentPropertyId: parentId,
                  /* A villa's floors are on the form above; a building's are asked here. */
                  ...(saved.property_type === "villa" ? {} : { floorsCount: floorsCount.trim() && Number(floorsCount) >= 0 ? Math.round(Number(floorsCount)) : null }),
                }
              : {}),
          });
        } catch (e) {
          toast.warning("The address was saved, but not its AMC details.", {
            description: e instanceof Error ? e.message : "Add them on the property's page.",
          });
        }
        onSaved(saved.id);
      }}
      extra={({ type }) => (
        <FormBlock title="For the maintenance contract" description="What AMC needs about this address beyond the unit. All optional.">
          <div className="grid gap-4 sm:grid-cols-2">
            {type === "commercial" ? (
              <FormField label="Kind of unit" htmlFor="amc-unit-kind">
                <Select value={commercialType ?? ""} onValueChange={(v) => setCommercialType(v as UnitType)}>
                  <SelectTrigger id="amc-unit-kind" className="w-full">
                    <SelectValue placeholder="Restaurant, clinic, shop…" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMERCIAL_TYPES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {UNIT_TYPE_LABELS[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            <FormField label="Occupied by" htmlFor="amc-occupancy">
              <Select value={occupancy ?? ""} onValueChange={(v) => setOccupancy(v as Occupancy)}>
                <SelectTrigger id="amc-occupancy" className="w-full">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                  <SelectItem value="vacant">Vacant</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {type !== "villa" && type !== "townhouse" ? (
              <FormField label="Floor" htmlFor="amc-floor">
                <Input id="amc-floor" value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={30} placeholder="e.g. 19" />
              </FormField>
            ) : null}
            <FormField label="Street" htmlFor="amc-street">
              <Input id="amc-street" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={200} />
            </FormField>
            <FormField label="City / emirate" htmlFor="amc-city">
              <Input id="amc-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="e.g. Dubai" />
            </FormField>
            {type === "commercial" ? (
              <FormField label="Zones (comma separated)" htmlFor="amc-zones">
                <Input id="amc-zones" value={zones} onChange={(e) => setZones(e.target.value)} maxLength={500} placeholder="e.g. Kitchen, Dining, Back of house" />
              </FormField>
            ) : null}
          </div>
          {full ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Address line" htmlFor="amc-address">
                <Input id="amc-address" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} maxLength={300} placeholder="e.g. Plot 12, Al Barsha 1" />
              </FormField>
              <FormField label="Unit no." htmlFor="amc-unit-no">
                <Input id="amc-unit-no" value={unitNo} onChange={(e) => setUnitNo(e.target.value)} maxLength={60} placeholder="e.g. 1904" />
              </FormField>
              {type !== "villa" ? (
                <FormField label="Floors in the building" htmlFor="amc-floors">
                  <Input id="amc-floors" type="number" inputMode="numeric" min={0} value={floorsCount} onChange={(e) => setFloorsCount(e.target.value)} placeholder="e.g. 40" />
                </FormField>
              ) : null}
              {parentOptions && parentOptions.length > 0 ? (
                <FormField label="Part of" htmlFor="amc-parent">
                  <Select value={parentId ?? "none"} onValueChange={(v) => setParentId(v === "none" ? null : v)}>
                    <SelectTrigger id="amc-parent" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not part of another property</SelectItem>
                      {parentOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}
            </div>
          ) : null}
          <FormField label="Access constraints" htmlFor="amc-access">
            <Textarea id="amc-access" rows={2} value={access} onChange={(e) => setAccess(e.target.value)} maxLength={2000} placeholder="e.g. No work on Fridays; service lift only" />
          </FormField>
          {full ? (
            <FormField label="Notes" htmlFor="amc-notes">
              <Textarea id="amc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </FormField>
          ) : null}
        </FormBlock>
      )}
    />
  );
}
