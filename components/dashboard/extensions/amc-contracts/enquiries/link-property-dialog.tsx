"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { amcContractsService, type PropertyInput } from "@/modules/amc-contracts/amc-contracts-service";
import { enquiriesService, type EnquiryRecord } from "@/modules/amc-contracts/enquiries-service";

import { AddressDialog, useAddressFormAccess } from "../address-dialog";
import { PropertyDialog } from "../customer-property-views";
import { EnquiryPropertySelect } from "./enquiry-property-select";
import { Field } from "./enquiry-ui";

/**
 * The property an enquiry is for: one of the client's addresses (saved, or in
 * Zoho FSM), or a new one entered on the address form, as on the Clients
 * page, with its pin on the map. A new one is linked as soon as it is saved.
 */
export function LinkPropertyDialog({
  open,
  onOpenChange,
  enquiry,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enquiry: EnquiryRecord;
  onLinked: () => void;
}) {
  const [propertyId, setPropertyId] = useState<string | null>(enquiry.property?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const addressForm = useAddressFormAccess();

  const link = async (id: string, message: string) => {
    setSaving(true);
    try {
      await enquiriesService.update(enquiry.id, { propertyId: id });
      toast.success(message);
      onOpenChange(false);
      onLinked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link the property.");
    } finally {
      setSaving(false);
    }
  };
  const defaults = { unitType: enquiry.unitType, propertyCategory: enquiry.propertyCategory, community: enquiry.area };

  return (
    <>
      <Dialog open={open && !adding} onOpenChange={(next) => !saving && onOpenChange(next)}>
        <ActionDialogContent busy={saving} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link a property</DialogTitle>
            <DialogDescription>The property this enquiry is for. Its assets and scope are captured at the site visit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="Property" hint={`Pick one of ${enquiry.customer.name}'s addresses, or add a new one.`}>
              <EnquiryPropertySelect customerId={enquiry.customer.id} value={propertyId} onChange={setPropertyId} onAddNew={() => setAdding(true)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <SubmitButton
              disabled={!propertyId || propertyId === enquiry.property?.id}
              pending={saving}
              pendingLabel="Linking…"
              icon={<Link2 className="size-4" />}
              onClick={() => propertyId && void link(propertyId, "Property linked")}
            >
              Link property
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>

      {/* The new address, on the Clients page's form; linked once saved. */}
      {addressForm ? (
        <AddressDialog
          open={open && adding}
          onOpenChange={(next) => !next && setAdding(false)}
          clientId={enquiry.customer.id}
          clientName={enquiry.customer.name}
          defaults={defaults}
          onSaved={(id) => {
            setAdding(false);
            void link(id, "Address added and linked");
          }}
        />
      ) : open && adding ? (
        <PropertyDialog
          title={`Add property for ${enquiry.customer.name}`}
          initial={{
            label: "",
            unitType: (enquiry.unitType as PropertyInput["unitType"]) ?? null,
            propertyCategory: (enquiry.propertyCategory as PropertyInput["propertyCategory"]) ?? null,
            community: enquiry.area,
          }}
          onOpenChange={(next) => !next && setAdding(false)}
          onSave={async (input) => {
            const { property } = await amcContractsService.createProperty(enquiry.customer.id, input);
            setAdding(false);
            await link(property.id, "Property added and linked");
          }}
        />
      ) : null}
    </>
  );
}
