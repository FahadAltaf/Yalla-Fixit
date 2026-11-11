"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DateTimeSelect from "@/components/ui/date-time-select";
import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

import { Field, PersonSelect, fromLocalInput, localInputIn } from "./enquiries/enquiry-ui";
import { PropertyPickerField, type PickedProperty } from "./property-picker-field";

/**
 * Book a site visit from a client or property page: the same form as Book
 * site visit on an enquiry (property, date and time, assessor). On a
 * property's page that property is fixed (Edit property only); on a
 * client's page one of their properties is picked or added.
 */
export function BookSiteVisitDialog({
  open,
  onOpenChange,
  client,
  propertyId,
  initialProperty,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: { id: string; name: string };
  /** The property whose page this is: fixed. Null on a client's page. */
  propertyId: string | null;
  /** That property as the page has it, and what it lacks for a visit: shown without reading it again. */
  initialProperty?: { property: PickedProperty; missing?: string[] };
}) {
  const [working, setWorking] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <ActionDialogContent busy={working} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? <BookSiteVisitForm client={client} fixedPropertyId={propertyId} initialProperty={initialProperty} working={working} setWorking={setWorking} onClose={() => onOpenChange(false)} /> : null}
      </ActionDialogContent>
    </Dialog>
  );
}

function BookSiteVisitForm({
  client,
  fixedPropertyId,
  initialProperty,
  working,
  setWorking,
  onClose,
}: {
  client: { id: string; name: string };
  fixedPropertyId: string | null;
  initialProperty?: { property: PickedProperty; missing?: string[] };
  working: boolean;
  setWorking: (working: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState<string | null>(fixedPropertyId);
  /* A visit needs a complete address (unit, project, type, bedrooms, built-up area). */
  const [propertyComplete, setPropertyComplete] = useState(false);
  const [when, setWhen] = useState(() => localInputIn(2, 10));
  const [people, setPeople] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [assessorId, setAssessorId] = useState<string | null>(null);
  const scheduledAt = fromLocalInput(when);

  useEffect(() => {
    let stale = false;
    amcContractsService.siteVisitPeople().then(
      ({ people, me }) => {
        if (stale) return;
        setPeople(people);
        setAssessorId((cur) => cur ?? (people.some((p) => p.id === me) ? me : null));
      },
      (e: unknown) => !stale && toast.error(e instanceof Error ? e.message : "Could not load the assessors."),
    );
    return () => {
      stale = true;
    };
  }, []);

  const book = async () => {
    if (!propertyId || !scheduledAt || !assessorId) return;
    setWorking(true);
    try {
      const { assessmentId, assessmentNumber } = await amcContractsService.bookSiteVisit({ customerId: client.id, propertyId, scheduledAt, assessorId });
      toast.success(`Site visit ${assessmentNumber} booked`);
      onClose();
      router.push(`/extensions/amc-contracts/assessments/${assessmentId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not book the site visit.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Book a site visit</DialogTitle>
        <DialogDescription>
          Opens a dated site visit for the property and assigns it; the assessor is told in the portal and records attendance, asset counts and findings on it.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label="Property" hint={propertyId ? undefined : `Pick one of ${client.name}'s properties, or add a new one.`}>
          <PropertyPickerField
            clientId={client.id}
            clientName={client.name}
            requireComplete
            onCompleteChange={setPropertyComplete}
            propertyId={propertyId}
            onChange={(id) => setPropertyId(id)}
            locked={Boolean(fixedPropertyId)}
            initial={initialProperty}
          />
        </Field>
        <Field label="Date and time" htmlFor="bsv-when">
          <DateTimeSelect id="bsv-when" value={when} onChange={setWhen} />
        </Field>
        <Field label="Assessor">
          <PersonSelect label="Assessor" people={people} value={assessorId} onChange={setAssessorId} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={working}>
          Cancel
        </Button>
        <SubmitButton
          disabled={!propertyId || !propertyComplete || !scheduledAt || !assessorId}
          pending={working}
          pendingLabel="Booking…"
          icon={<CalendarPlus className="size-4" />}
          onClick={() => void book()}
        >
          Book site visit
        </SubmitButton>
      </DialogFooter>
    </>
  );
}
