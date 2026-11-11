"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import { amcContractsService, type PropertyOverview } from "@/modules/amc-contracts/amc-contracts-service";

import { AddressDialog, useAddressFormAccess } from "./address-dialog";
import { EnquiryPropertySelect } from "./enquiries/enquiry-property-select";
import { LinkedCard, printedAddress } from "./linked-card";

export type PickedProperty = PropertyOverview["property"];

/**
 * A client's property on a form, as New proposal and New enquiry show it: once
 * picked, a card (name, type, category, address) with Edit property and
 * Change; until then the client's list with "Add a new property", which opens
 * the address form. With `requireComplete` (a site visit) only a complete
 * address can be used: one already linked that lacks something says what on
 * its card (Edit property fills it in), and a new one is asked in full.
 */
export function PropertyPickerField({
  clientId,
  clientName,
  propertyId,
  onChange,
  requireComplete = false,
  onCompleteChange,
  defaults,
  locked = false,
  initial,
}: {
  clientId: string;
  clientName: string;
  propertyId: string | null;
  /** Told the property picked (its record, for the caller's own fields), or null when it is cleared. */
  onChange: (propertyId: string | null, property: PickedProperty | null) => void;
  requireComplete?: boolean;
  /** With requireComplete: whether the property chosen has what a site visit needs, so the caller can hold its save. */
  onCompleteChange?: (complete: boolean) => void;
  /** What is already known about the property, for a new address. */
  defaults?: { unitType?: string | null; propertyCategory?: string | null; community?: string | null };
  /** The property is fixed (set on the enquiry): it can be edited, not changed. */
  locked?: boolean;
  /** The property as the page already has it (and what it lacks for a site visit), so it is not read again. */
  initial?: { property: PickedProperty; missing?: string[] };
}) {
  const addressForm = useAddressFormAccess();
  const [property, setProperty] = useState<PickedProperty | null>(initial && initial.property.id === propertyId ? initial.property : null);
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [listKey, setListKey] = useState(0);
  const [loading, setLoading] = useState(false);
  /* What the address on file lacks for a site visit, checked for the property shown. */
  const [checked, setChecked] = useState<{ id: string; missing: string[] } | null>(
    initial && initial.property.id === propertyId && initial.missing ? { id: initial.property.id, missing: initial.missing } : null,
  );

  /* One read of the property: its card, and (for a site visit) what its address lacks. */
  const read = async (id: string) => {
    const { property, siteVisitMissing } = await amcContractsService.propertyCard(id);
    if (requireComplete) setChecked({ id, missing: siteVisitMissing });
    return property;
  };

  /* The property already chosen, read for its card unless the page handed it over. */
  useEffect(() => {
    if (!propertyId || (property?.id === propertyId && (!requireComplete || checked?.id === propertyId))) return;
    let stale = false;
    setLoading(true);
    read(propertyId)
      .then(
        (p) => !stale && setProperty(p),
        (e: unknown) => {
          if (stale) return;
          /* Unknown: the server checks again when the visit is booked. */
          setChecked({ id: propertyId, missing: [] });
          toast.error(e instanceof Error ? e.message : "Could not read the property.");
        },
      )
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the property chosen changes
  }, [propertyId]);

  const missing = requireComplete && propertyId && checked?.id === propertyId ? checked.missing : [];
  const complete = !requireComplete || (Boolean(propertyId) && checked?.id === propertyId && checked.missing.length === 0);
  useEffect(() => {
    onCompleteChange?.(complete);
  }, [complete, onCompleteChange]);

  /* Picked (or just added or edited): read it, then tell the caller. */
  const pick = async (id: string | null) => {
    if (!id) {
      setProperty(null);
      onChange(null, null);
      return;
    }
    setLoading(true);
    try {
      const p = await read(id);
      setProperty(p);
      onChange(id, p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the property.");
    } finally {
      setLoading(false);
    }
  };

  const shown = property && property.id === propertyId ? property : null;
  const category = shown?.propertyCategory === "commercial" ? "Commercial" : shown?.propertyCategory === "residential" ? "Residential" : null;

  return (
    <>
      {propertyId ? (
        <LinkedCard
          title={shown?.label || (loading ? "Reading the property…" : "Property")}
          detail={
            [shown?.unitType ? (UNIT_TYPE_LABELS[shown.unitType as keyof typeof UNIT_TYPE_LABELS] ?? shown.unitType) : null, category, shown ? printedAddress(shown) : null]
              .filter(Boolean)
              .join(" · ") || (loading ? "" : "No details on file yet")
          }
          note={
            missing.length
              ? `A site visit needs ${missing.join(", ").toLowerCase()}. ${addressForm ? "Use Edit property to add it." : "Someone with Snagging access can add it on the Clients page."}`
              : undefined
          }
          noteTone="warning"
          onEdit={addressForm ? () => setDialog("edit") : undefined}
          editLabel="Edit property"
          onChange={locked ? undefined : () => void pick(null)}
          busy={loading}
        />
      ) : (
        <EnquiryPropertySelect
          customerId={clientId}
          clientName={clientName}
          requireComplete={requireComplete}
          value={null}
          refreshKey={listKey}
          onChange={(id) => void pick(id)}
          onAddNew={addressForm ? () => setDialog("add") : undefined}
        />
      )}
      {addressForm ? (
        <AddressDialog
          open={dialog !== null}
          onOpenChange={(open) => !open && setDialog(null)}
          clientId={clientId}
          clientName={clientName}
          defaults={defaults}
          propertyId={dialog === "edit" ? propertyId : null}
          /* For a site visit an address missing something opens to complete it (those fields required); otherwise the full edit. */
          editing={dialog === "edit" && missing.length === 0}
          /* A site visit needs a complete address; elsewhere only its reference. */
          full={dialog === "add" && !requireComplete}
          /* Editing for a site visit: what it still lacks is said, and asked for, in the form. */
          missing={dialog === "edit" ? missing : undefined}
          onSaved={(id) => {
            setDialog(null);
            setListKey((k) => k + 1);
            void pick(id);
          }}
        />
      ) : null}
    </>
  );
}
