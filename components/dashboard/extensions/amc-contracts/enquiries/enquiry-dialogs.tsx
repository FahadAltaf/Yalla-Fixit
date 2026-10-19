"use client";

import { useState } from "react";
import { CalendarPlus, CheckCircle2, MessageSquarePlus, Save, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DateTimeSelect from "@/components/ui/date-time-select";
import { CHANNEL_LABELS, PREFERRED_CHANNELS, UNIT_TYPES, UNIT_TYPE_CATEGORY, UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import {
  CLOSED_STAGES,
  ENQUIRY_STAGE,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_CHANNEL_LABELS,
  checkStageChange,
  type FollowUpChannel,
} from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import { amcContractsService, type PropertyInput } from "@/modules/amc-contracts/amc-contracts-service";
import { enquiriesService, type EnquiryMeta, type EnquiryRecord, type UpdateEnquiryInput } from "@/modules/amc-contracts/enquiries-service";

import { PropertyDialog } from "../customer-property-views";
import { AddressDialog, useAddressFormAccess } from "../address-dialog";
import { EnquiryPropertySelect } from "./enquiry-property-select";
import { Field, PersonSelect, SimpleSelect, fromLocalInput, localInputIn, toLocalInput } from "./enquiry-ui";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

type Work = { working: boolean; run: (action: () => Promise<void>, fallback: string) => Promise<void> };

/**
 * The dialog shell every form here shares, as on Snagging: always mounted
 * and controlled, undismissable while it saves, closed only once the save
 * has worked, and a failure said in a toast with the form left as it was.
 * The form itself renders inside the content, so it starts fresh on each open.
 */
function WorkDialog({
  open,
  onOpenChange,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: (work: Work) => React.ReactNode;
}) {
  const [working, setWorking] = useState(false);
  const run = async (action: () => Promise<void>, fallback: string) => {
    setWorking(true);
    try {
      await action();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallback);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={working} className={className}>
        {children({ working, run })}
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Log or edit an enquiry (DEV-358)                                    */
/* ------------------------------------------------------------------ */

type EnquiryDraft = UpdateEnquiryInput & { source: string; contactName: string; need: string };

function draftFrom(e: EnquiryRecord): EnquiryDraft {
  return {
    source: e.source,
    referrer: e.referrer,
    contactName: e.contactName,
    contactPhone: e.contactPhone,
    contactEmail: e.contactEmail,
    contactWhatsapp: e.contactWhatsapp,
    preferredChannel: (e.preferredChannel as EnquiryDraft["preferredChannel"]) ?? null,
    preferredLanguage: e.preferredLanguage,
    area: e.area,
    propertyCategory: (e.propertyCategory as EnquiryDraft["propertyCategory"]) ?? null,
    unitType: (e.unitType as EnquiryDraft["unitType"]) ?? null,
    need: e.need,
    ownerId: e.owner?.id ?? null,
    propertyId: e.property?.id ?? null,
    nextFollowUpAt: e.nextFollowUpAt,
  };
}

/** Blank strings out, so the server sees "not given" rather than "". */
function cleanDraft(d: EnquiryDraft): EnquiryDraft {
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    ...d,
    referrer: t(d.referrer),
    contactPhone: t(d.contactPhone),
    contactEmail: t(d.contactEmail),
    contactWhatsapp: t(d.contactWhatsapp),
    preferredLanguage: t(d.preferredLanguage),
    area: t(d.area),
    contactName: d.contactName.trim(),
    need: d.need.trim(),
  };
}

type EnquiryFormProps = {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  /** Told about the saved enquiry before the dialog closes (toast, reload). */
  onSaved: (saved: EnquiryRecord) => void | Promise<void>;
};

/** Edit an enquiry. A new one is logged on its own page (New enquiry), as a quotation is. */
export function EnquiryFormDialog({ open, onOpenChange, ...props }: EnquiryFormProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <WorkDialog open={open} onOpenChange={onOpenChange} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
      {(work) => <EnquiryForm {...props} work={work} onCancel={() => onOpenChange(false)} />}
    </WorkDialog>
  );
}

function EnquiryForm({ meta, enquiry, onSaved, work, onCancel }: EnquiryFormProps & { work: Work; onCancel: () => void }) {
  const [draft, setDraft] = useState<EnquiryDraft>(() => draftFrom(enquiry));
  const set = (patch: Partial<EnquiryDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const referral = /referr/i.test(draft.source);

  const save = () =>
    work.run(async () => {
      const { enquiry: saved } = await enquiriesService.update(enquiry.id, cleanDraft(draft));
      await onSaved(saved);
    }, "Could not save the enquiry.");

  const reachable = !!(draft.contactPhone?.trim() || draft.contactEmail?.trim() || draft.contactWhatsapp?.trim());
  const ready = !!draft.contactName.trim() && reachable && draft.need.trim().length >= 3 && !!draft.source && (!referral || !!draft.referrer?.trim());

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {enquiry.enquiryNumber}</DialogTitle>
        <DialogDescription>Saves the changes to this enquiry. The stage is changed separately.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 py-2">
        <section className="grid gap-4">
          <h3 className="text-sm font-medium">Contact</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name" htmlFor="enq-contact">
              <Input id="enq-contact" value={draft.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={200} />
            </Field>
            <Field label="Phone" htmlFor="enq-phone">
              <Input id="enq-phone" inputMode="tel" value={draft.contactPhone ?? ""} onChange={(e) => set({ contactPhone: e.target.value })} maxLength={40} />
            </Field>
            <Field label="Email" htmlFor="enq-email">
              <Input id="enq-email" type="email" value={draft.contactEmail ?? ""} onChange={(e) => set({ contactEmail: e.target.value })} maxLength={200} />
            </Field>
            <Field label="WhatsApp" htmlFor="enq-wa">
              <Input id="enq-wa" inputMode="tel" value={draft.contactWhatsapp ?? ""} onChange={(e) => set({ contactWhatsapp: e.target.value })} maxLength={40} />
            </Field>
            <Field label="Preferred channel">
              <SimpleSelect
                label="Preferred channel"
                allowNone
                value={draft.preferredChannel}
                options={PREFERRED_CHANNELS.map((c) => [c, CHANNEL_LABELS[c] ?? c])}
                onChange={(v) => set({ preferredChannel: v as EnquiryDraft["preferredChannel"] })}
              />
            </Field>
            <Field label="Preferred language" htmlFor="enq-lang">
              <Input id="enq-lang" placeholder="English, Arabic…" value={draft.preferredLanguage ?? ""} onChange={(e) => set({ preferredLanguage: e.target.value })} maxLength={40} />
            </Field>
          </div>
          <p className={cn("text-xs", reachable ? "text-muted-foreground" : "text-warning")}>A phone, WhatsApp or email is needed.</p>
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-medium">Enquiry</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source">
              <SimpleSelect label="Source" value={draft.source} options={meta.sources.map((s) => [s, s])} onChange={(v) => set({ source: v ?? "" })} />
            </Field>
            {referral ? (
              <Field label="Referred by" htmlFor="enq-ref">
                <Input id="enq-ref" value={draft.referrer ?? ""} onChange={(e) => set({ referrer: e.target.value })} maxLength={200} />
              </Field>
            ) : null}
            <Field label="Area" htmlFor="enq-area">
              <Input id="enq-area" placeholder="Community or district" value={draft.area ?? ""} onChange={(e) => set({ area: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Property type">
              <SimpleSelect
                label="Property type"
                allowNone
                value={draft.unitType}
                options={UNIT_TYPES.map((t) => [t, UNIT_TYPE_LABELS[t]])}
                onChange={(v) =>
                  set({
                    unitType: v as EnquiryDraft["unitType"],
                    propertyCategory: v ? (UNIT_TYPE_CATEGORY[v as keyof typeof UNIT_TYPE_CATEGORY] as EnquiryDraft["propertyCategory"]) ?? draft.propertyCategory : draft.propertyCategory,
                  })
                }
              />
            </Field>
            <Field label="Category">
              <SimpleSelect
                label="Category"
                allowNone
                value={draft.propertyCategory}
                options={[
                  ["residential", "Residential"],
                  ["commercial", "Commercial"],
                ]}
                onChange={(v) => set({ propertyCategory: v as EnquiryDraft["propertyCategory"] })}
              />
            </Field>
            <Field label="Property" className="sm:col-span-2">
              <EnquiryPropertySelect customerId={enquiry.customer.id} value={draft.propertyId ?? null} onChange={(id) => set({ propertyId: id })} />
            </Field>
            <Field label="What the client needs" htmlFor="enq-need" className="sm:col-span-2">
              <Textarea id="enq-need" rows={3} value={draft.need} onChange={(e) => set({ need: e.target.value })} maxLength={2000} placeholder="In short: services, units, timing, anything agreed" />
            </Field>
            <Field label="Owner">
              <PersonSelect label="Owner" people={meta.people} value={draft.ownerId ?? null} onChange={(id) => set({ ownerId: id })} allowNone />
            </Field>
            <Field label="Next follow-up" htmlFor="enq-next">
              <DateTimeSelect id="enq-next" value={toLocalInput(draft.nextFollowUpAt)} onChange={(value) => set({ nextFollowUpAt: fromLocalInput(value) })} />
            </Field>
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={work.working}>
          Cancel
        </Button>
        <SubmitButton onClick={() => void save()} disabled={!ready} pending={work.working} pendingLabel="Saving…" icon={<Save className="size-4" />}>
          Save
        </SubmitButton>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Change stage (DEV-359)                                              */
/* ------------------------------------------------------------------ */

type StageProps = {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  hasCompletedSiteVisit: boolean;
  initialStage?: string;
  /** Saves, says so and reloads; a throw keeps the dialog open. */
  onSave: (input: { stage: string; reason?: string | null; lostReason?: string | null; lostNotes?: string | null }) => Promise<void>;
};

export function StageDialog({ open, onOpenChange, ...props }: StageProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <WorkDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-md">
      {(work) => <StageForm {...props} work={work} onCancel={() => onOpenChange(false)} />}
    </WorkDialog>
  );
}

function StageForm({ meta, enquiry, hasCompletedSiteVisit, initialStage, onSave, work, onCancel }: StageProps & { work: Work; onCancel: () => void }) {
  const [stage, setStage] = useState<string>(initialStage ?? "");
  const [reason, setReason] = useState("");
  const [lostReason, setLostReason] = useState<string | null>(null);
  const [lostNotes, setLostNotes] = useState("");
  const lost = stage === ENQUIRY_STAGE.lost;
  const reopening = CLOSED_STAGES.includes(enquiry.stage);
  /* The same check the server runs, so the warning shows before saving. */
  const preview = stage
    ? checkStageChange({
        config: {
          enquiries: { stages: meta.stages, lostReasons: meta.lostReasons },
          proposals: { siteVisitRequiredCategories: meta.siteVisitRequiredCategories, siteVisitRule: meta.siteVisitRule },
        },
        from: enquiry.stage,
        to: stage,
        reason,
        lostReason: lost ? lostReason : null,
        propertyCategory: enquiry.property?.propertyCategory ?? enquiry.propertyCategory,
        hasCompletedSiteVisit,
      })
    : null;
  const blocked = preview && !preview.ok && preview.status === 409 ? preview.error : null;
  const ready = !!stage && stage !== enquiry.stage && (!lost || !!lostReason) && (!reopening || !!reason.trim()) && !blocked;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change stage</DialogTitle>
        <DialogDescription>
          Moves {enquiry.enquiryNumber} on from {enquiry.stage}; the change is recorded with your name and the time.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label="New stage">
          <SimpleSelect label="New stage" value={stage} options={meta.stages.filter((s) => s !== enquiry.stage).map((s) => [s, s])} onChange={(v) => setStage(v ?? "")} />
        </Field>
        {lost ? (
          <>
            <Field label="Why was it lost?">
              <SimpleSelect label="Lost reason" value={lostReason} options={meta.lostReasons.map((r) => [r, r])} onChange={setLostReason} />
            </Field>
            <Field label="Notes (optional)" htmlFor="stage-lost-notes">
              <Textarea id="stage-lost-notes" rows={2} value={lostNotes} onChange={(e) => setLostNotes(e.target.value)} maxLength={1000} />
            </Field>
          </>
        ) : (
          <Field label={reopening ? `Why reopen an enquiry that is ${enquiry.stage}?` : "Note (optional)"} htmlFor="stage-reason">
            <Textarea id="stage-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}
        {blocked ? (
          <p className="text-danger text-sm">{blocked}</p>
        ) : preview && preview.ok && preview.warning ? (
          <p className="border-warning/30 bg-warning/5 rounded-md border px-3 py-2 text-sm">{preview.warning} You can continue; it is recorded.</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={work.working}>
          Cancel
        </Button>
        <SubmitButton
          variant={lost ? "destructive" : "default"}
          disabled={!ready}
          pending={work.working}
          pendingLabel="Saving…"
          icon={lost ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
          onClick={() =>
            void work.run(
              () => onSave({ stage, reason: reason.trim() || null, lostReason: lost ? lostReason : null, lostNotes: lost ? lostNotes.trim() || null : null }),
              "Could not change the stage.",
            )
          }
        >
          {lost ? "Mark lost" : "Change stage"}
        </SubmitButton>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Log a follow-up (DEV-359)                                           */
/* ------------------------------------------------------------------ */

type FollowUpProps = {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  onSave: (input: { occurredAt: string; channel: FollowUpChannel; outcome: string; notes: string | null; nextFollowUpAt: string | null; moveToStage: string | null }) => Promise<void>;
};

export function FollowUpDialog({ open, onOpenChange, ...props }: FollowUpProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <WorkDialog open={open} onOpenChange={onOpenChange} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
      {(work) => <FollowUpForm {...props} work={work} onCancel={() => onOpenChange(false)} />}
    </WorkDialog>
  );
}

function FollowUpForm({ meta, enquiry, onSave, work, onCancel }: FollowUpProps & { work: Work; onCancel: () => void }) {
  const [when, setWhen] = useState(() => localInputIn(0));
  const [channel, setChannel] = useState<FollowUpChannel>(
    (FOLLOW_UP_CHANNELS as readonly string[]).includes(enquiry.preferredChannel ?? "") ? (enquiry.preferredChannel as FollowUpChannel) : "call",
  );
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState(() => localInputIn(2, 10));
  const [moveTo, setMoveTo] = useState<string | null>(null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Log a follow-up</DialogTitle>
        <DialogDescription>Records the contact, resets the idle clock and adds it to the client&apos;s communication log.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When" htmlFor="fu-when">
            <DateTimeSelect id="fu-when" value={when} onChange={setWhen} />
          </Field>
          <Field label="Channel">
            <SimpleSelect label="Channel" value={channel} options={FOLLOW_UP_CHANNELS.map((c) => [c, FOLLOW_UP_CHANNEL_LABELS[c]])} onChange={(v) => setChannel((v as FollowUpChannel) ?? "call")} />
          </Field>
        </div>
        <Field label="Outcome" htmlFor="fu-outcome">
          <Input id="fu-outcome" placeholder="Spoke to Sara; wants a quote for 6 AC units" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Notes (optional)" htmlFor="fu-notes">
          <Textarea id="fu-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Next follow-up" htmlFor="fu-next">
            <DateTimeSelect id="fu-next" value={next} onChange={setNext} />
          </Field>
          <Field label="Move to stage (optional)">
            <SimpleSelect
              label="Move to stage"
              allowNone
              noneLabel="Stay where it is"
              placeholder="Stay where it is"
              value={moveTo}
              /* Lost needs its reason and Won comes from the client accepting: both go through Change stage. */
              options={meta.stages.filter((s) => s !== enquiry.stage && s !== ENQUIRY_STAGE.lost && s !== ENQUIRY_STAGE.won).map((s) => [s, s])}
              onChange={setMoveTo}
            />
          </Field>
        </div>
        {!next ? <p className="text-muted-foreground text-xs">With no next follow-up, the enquiry goes idle after {meta.idleDays} days.</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={work.working}>
          Cancel
        </Button>
        <SubmitButton
          disabled={outcome.trim().length < 2}
          pending={work.working}
          pendingLabel="Saving…"
          icon={<MessageSquarePlus className="size-4" />}
          onClick={() =>
            void work.run(
              () =>
                onSave({
                  occurredAt: fromLocalInput(when) ?? new Date().toISOString(),
                  channel,
                  outcome: outcome.trim(),
                  notes: notes.trim() || null,
                  nextFollowUpAt: fromLocalInput(next),
                  moveToStage: moveTo,
                }),
              "Could not log the follow-up.",
            )
          }
        >
          Log follow-up
        </SubmitButton>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Book a site visit (DEV-362)                                         */
/* ------------------------------------------------------------------ */

type SiteVisitProps = {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  onSave: (input: { propertyId: string; scheduledAt: string; assessorId: string }) => Promise<void>;
};

export function SiteVisitDialog({ open, onOpenChange, ...props }: SiteVisitProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <WorkDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-lg">
      {(work) => <SiteVisitForm {...props} work={work} onCancel={() => onOpenChange(false)} />}
    </WorkDialog>
  );
}

function SiteVisitForm({ meta, enquiry, onSave, work, onCancel }: SiteVisitProps & { work: Work; onCancel: () => void }) {
  const [propertyId, setPropertyId] = useState<string | null>(enquiry.property?.id ?? null);
  /* A visit needs a complete address (unit, project, type, bedrooms, built-up area). */
  const [propertyComplete, setPropertyComplete] = useState(false);
  const [when, setWhen] = useState(() => localInputIn(2, 10));
  const [assessorId, setAssessorId] = useState<string | null>(enquiry.owner?.id ?? meta.me);
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyVersion, setPropertyVersion] = useState(0);
  /* A new address on the Clients page's form (with the map) when Snagging addresses can be added; the AMC form otherwise. */
  const addressForm = useAddressFormAccess();
  const scheduledAt = fromLocalInput(when);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Book a site visit</DialogTitle>
        <DialogDescription>
          Opens a dated site visit for the property and assigns it; the assessor is told in the portal and records attendance, asset counts and findings on it.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        {/* The client's saved and Zoho FSM addresses, or a new one added here. */}
        <Field label="Property" hint={`Pick one of ${enquiry.customer.name}'s properties, or add a new one.`}>
          <EnquiryPropertySelect
            customerId={enquiry.customer.id}
            clientName={enquiry.customer.name}
            requireComplete
            onCompleteChange={setPropertyComplete}
            value={propertyId}
            onChange={setPropertyId}
            onAddNew={() => setAddingProperty(true)}
            refreshKey={propertyVersion}
          />
        </Field>
        <Field label="Date and time" htmlFor="sv-when">
          <DateTimeSelect id="sv-when" value={when} onChange={setWhen} />
        </Field>
        <Field label="Assessor">
          <PersonSelect label="Assessor" people={meta.people} value={assessorId} onChange={setAssessorId} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={work.working}>
          Cancel
        </Button>
        <SubmitButton
          disabled={!propertyId || !propertyComplete || !scheduledAt || !assessorId}
          pending={work.working}
          pendingLabel="Booking…"
          icon={<CalendarPlus className="size-4" />}
          onClick={() => void work.run(() => onSave({ propertyId: propertyId!, scheduledAt: scheduledAt!, assessorId: assessorId! }), "Could not book the site visit.")}
        >
          Book site visit
        </SubmitButton>
      </DialogFooter>
      {addressForm ? (
        <AddressDialog
          open={addingProperty}
          onOpenChange={(open) => !open && setAddingProperty(false)}
          clientId={enquiry.customer.id}
          clientName={enquiry.customer.name}
          defaults={{ unitType: enquiry.unitType, propertyCategory: enquiry.propertyCategory, community: enquiry.area }}
          onSaved={(id) => {
            setPropertyId(id);
            setPropertyVersion((v) => v + 1);
            setAddingProperty(false);
          }}
        />
      ) : addingProperty ? (
        <PropertyDialog
          title={`Add property for ${enquiry.customer.name}`}
          initial={{
            label: "",
            unitType: (enquiry.unitType as PropertyInput["unitType"]) ?? null,
            propertyCategory: (enquiry.propertyCategory as PropertyInput["propertyCategory"]) ?? null,
            community: enquiry.area,
          }}
          onOpenChange={(open) => !open && setAddingProperty(false)}
          onSave={async (input) => {
            const { property } = await amcContractsService.createProperty(enquiry.customer.id, input);
            setPropertyId(property.id);
            setPropertyVersion((v) => v + 1);
            setAddingProperty(false);
          }}
        />
      ) : null}
    </>
  );
}
