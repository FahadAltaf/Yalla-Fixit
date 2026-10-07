"use client";

import { useState } from "react";

import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, PREFERRED_CHANNELS, UNIT_TYPES, UNIT_TYPE_CATEGORY, UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import {
  CLOSED_STAGES,
  ENQUIRY_STAGE,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_CHANNEL_LABELS,
  checkStageChange,
  type FollowUpChannel,
} from "@/lib/amc/enquiries";
import { amcContractsService, type CustomerRecord, type PropertyInput } from "@/modules/amc-contracts/amc-contracts-service";
import { enquiriesService, type CreateEnquiryInput, type EnquiryMeta, type EnquiryRecord, type UpdateEnquiryInput } from "@/modules/amc-contracts/enquiries-service";

import { CustomerSearch, PropertySelect } from "../customer-pickers";
import { PropertyDialog } from "../customer-property-views";
import { PersonSelect, fromLocalInput, localInputIn, toLocalInput } from "./enquiry-ui";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="text-destructive text-sm" role="alert">
      {error}
    </p>
  ) : null;
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function SimpleSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  allowNone = false,
}: {
  label: string;
  value: string | null | undefined;
  options: Array<[string, string]>;
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
}) {
  return (
    <Select value={value ?? (allowNone ? "none" : "")} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value="none">Not set</SelectItem> : null}
        {options.map(([k, l]) => (
          <SelectItem key={k} value={k}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* Log or edit an enquiry (DEV-358)                                    */
/* ------------------------------------------------------------------ */

type EnquiryDraft = UpdateEnquiryInput & { source: string; contactName: string; need: string };

function draftFrom(e: EnquiryRecord | null, meta: EnquiryMeta): EnquiryDraft {
  if (!e) {
    return {
      source: meta.sources[0] ?? "",
      contactName: "",
      need: "",
      ownerId: meta.me,
      nextFollowUpAt: fromLocalInput(localInputIn(1, 10)),
    };
  }
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

export function EnquiryFormDialog({
  meta,
  enquiry,
  onClose,
  onSaved,
}: {
  meta: EnquiryMeta;
  /** null = log a new enquiry. */
  enquiry: EnquiryRecord | null;
  onClose: () => void;
  onSaved: (saved: EnquiryRecord) => void;
}) {
  const creating = enquiry === null;
  const [draft, setDraft] = useState<EnquiryDraft>(() => draftFrom(enquiry, meta));
  const [clientMode, setClientMode] = useState<"new" | "existing">("new");
  const [existing, setExisting] = useState<CustomerRecord | null>(null);
  const [newClient, setNewClient] = useState<{ name: string; customerType: "individual" | "company" | null; company: string }>({
    name: "",
    customerType: "individual",
    company: "",
  });
  const { busy, error, run } = useSubmit();
  const set = (patch: Partial<EnquiryDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const referral = /referr/i.test(draft.source);

  const save = () =>
    run(async () => {
      const clean = cleanDraft(draft);
      if (creating) {
        const input: CreateEnquiryInput = {
          ...clean,
          customerId: clientMode === "existing" ? (existing?.id ?? null) : null,
          newCustomer:
            clientMode === "new"
              ? { name: newClient.name.trim(), customerType: newClient.customerType, company: newClient.company.trim() || null }
              : null,
        };
        const { enquiry: saved } = await enquiriesService.create(input);
        onSaved(saved);
      } else {
        const { enquiry: saved } = await enquiriesService.update(enquiry.id, clean);
        onSaved(saved);
      }
    });

  const clientReady = !creating || (clientMode === "existing" ? !!existing : !!newClient.name.trim());
  const ready = clientReady && !!draft.contactName.trim() && draft.need.trim().length >= 3 && !!draft.source;

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{creating ? "Log an enquiry" : `Edit ${enquiry.enquiryNumber}`}</DialogTitle>
          <DialogDescription>
            {creating
              ? "A new client becomes a prospect record now, so nothing is typed twice later."
              : "Changes are recorded. The stage is changed separately."}
          </DialogDescription>
        </DialogHeader>

        {creating ? (
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Client</h3>
              <div className="bg-muted inline-flex rounded-full p-0.5 text-sm" role="tablist" aria-label="Client">
                {(["new", "existing"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={clientMode === m}
                    onClick={() => setClientMode(m)}
                    className={`rounded-full px-3 py-1 ${clientMode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                  >
                    {m === "new" ? "New prospect" : "Existing client"}
                  </button>
                ))}
              </div>
            </div>
            {clientMode === "existing" ? (
              <>
                <CustomerSearch
                  selectedId={existing?.id}
                  onPick={(c) => {
                    setExisting(c);
                    set({ contactName: draft.contactName || c.name, contactPhone: draft.contactPhone || c.phone, contactEmail: draft.contactEmail || c.email });
                  }}
                />
                {existing ? <p className="text-muted-foreground text-xs">Linked to {existing.name}.</p> : null}
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Client name" htmlFor="enq-client" className="sm:col-span-2">
                  <Input id="enq-client" value={newClient.name} onChange={(e) => setNewClient((c) => ({ ...c, name: e.target.value }))} maxLength={200} />
                </Field>
                <Field label="Type">
                  <SimpleSelect
                    label="Client type"
                    value={newClient.customerType}
                    options={[
                      ["individual", "Individual"],
                      ["company", "Company"],
                    ]}
                    onChange={(v) => setNewClient((c) => ({ ...c, customerType: v as "individual" | "company" | null }))}
                  />
                </Field>
                {newClient.customerType === "company" ? (
                  <Field label="Company" htmlFor="enq-company" className="sm:col-span-3">
                    <Input id="enq-company" value={newClient.company} onChange={(e) => setNewClient((c) => ({ ...c, company: e.target.value }))} maxLength={200} />
                  </Field>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        <section className="grid gap-3">
          <h3 className="text-sm font-medium">Contact</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact name" htmlFor="enq-contact">
              <Input id="enq-contact" value={draft.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={200} />
            </Field>
            <Field label="Phone" htmlFor="enq-phone">
              <Input id="enq-phone" inputMode="tel" value={draft.contactPhone ?? ""} onChange={(e) => set({ contactPhone: e.target.value })} maxLength={40} />
            </Field>
            <Field label="WhatsApp" htmlFor="enq-wa">
              <Input id="enq-wa" inputMode="tel" value={draft.contactWhatsapp ?? ""} onChange={(e) => set({ contactWhatsapp: e.target.value })} maxLength={40} />
            </Field>
            <Field label="Email" htmlFor="enq-email">
              <Input id="enq-email" type="email" value={draft.contactEmail ?? ""} onChange={(e) => set({ contactEmail: e.target.value })} maxLength={200} />
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
          <p className="text-muted-foreground text-xs">A phone, WhatsApp or email is needed.</p>
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-medium">Enquiry</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source">
              <SimpleSelect label="Source" value={draft.source} options={meta.sources.map((s) => [s, s])} onChange={(v) => set({ source: v ?? "" })} />
            </Field>
            {referral ? (
              <Field label="Referred by" htmlFor="enq-ref">
                <Input id="enq-ref" value={draft.referrer ?? ""} onChange={(e) => set({ referrer: e.target.value })} maxLength={200} />
              </Field>
            ) : (
              <Field label="Area" htmlFor="enq-area">
                <Input id="enq-area" placeholder="Community or district" value={draft.area ?? ""} onChange={(e) => set({ area: e.target.value })} maxLength={120} />
              </Field>
            )}
            {referral ? (
              <Field label="Area" htmlFor="enq-area2">
                <Input id="enq-area2" placeholder="Community or district" value={draft.area ?? ""} onChange={(e) => set({ area: e.target.value })} maxLength={120} />
              </Field>
            ) : null}
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
            {!creating ? (
              <Field label="Property" className="sm:col-span-2">
                <PropertySelect customerId={enquiry.customer.id} value={draft.propertyId ?? null} onChange={(p) => set({ propertyId: p?.id ?? null })} />
              </Field>
            ) : null}
            <Field label="What the client needs" htmlFor="enq-need" className="sm:col-span-2">
              <Textarea id="enq-need" rows={3} value={draft.need} onChange={(e) => set({ need: e.target.value })} maxLength={2000} placeholder="In short: services, units, timing, anything agreed" />
            </Field>
            <Field label="Owner">
              <PersonSelect label="Owner" people={meta.people} value={draft.ownerId ?? null} onChange={(id) => set({ ownerId: id })} allowNone />
            </Field>
            <Field label="Next follow-up" htmlFor="enq-next">
              <Input id="enq-next" type="datetime-local" value={toLocalInput(draft.nextFollowUpAt)} onChange={(e) => set({ nextFollowUpAt: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
        </section>

        <FormError error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? "Saving…" : creating ? "Log enquiry" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Change stage (DEV-359)                                              */
/* ------------------------------------------------------------------ */

export function StageDialog({
  meta,
  enquiry,
  hasCompletedSiteVisit,
  initialStage,
  onClose,
  onSave,
}: {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  hasCompletedSiteVisit: boolean;
  initialStage?: string;
  onClose: () => void;
  onSave: (input: { stage: string; reason?: string | null; lostReason?: string | null; lostNotes?: string | null }) => Promise<void>;
}) {
  const [stage, setStage] = useState<string>(initialStage ?? "");
  const [reason, setReason] = useState("");
  const [lostReason, setLostReason] = useState<string | null>(null);
  const [lostNotes, setLostNotes] = useState("");
  const { busy, error, run } = useSubmit();
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
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change stage</DialogTitle>
          <DialogDescription>
            {enquiry.enquiryNumber} is at {enquiry.stage}. The change is recorded with your name and the time.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
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
            <p className="text-destructive text-sm">{blocked}</p>
          ) : preview && preview.ok && preview.warning ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{preview.warning} You can continue; it is recorded.</p>
          ) : null}
        </div>
        <FormError error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={lost ? "destructive" : "default"}
            disabled={busy || !ready}
            onClick={() => void run(() => onSave({ stage, reason: reason.trim() || null, lostReason: lost ? lostReason : null, lostNotes: lost ? lostNotes.trim() || null : null }))}
          >
            {busy ? "Saving…" : lost ? "Mark lost" : "Change stage"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Log a follow-up (DEV-359)                                           */
/* ------------------------------------------------------------------ */

export function FollowUpDialog({
  meta,
  enquiry,
  onClose,
  onSave,
}: {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  onClose: () => void;
  onSave: (input: { occurredAt: string; channel: FollowUpChannel; outcome: string; notes: string | null; nextFollowUpAt: string | null; moveToStage: string | null }) => Promise<void>;
}) {
  const [when, setWhen] = useState(() => localInputIn(0));
  const [channel, setChannel] = useState<FollowUpChannel>(
    (FOLLOW_UP_CHANNELS as readonly string[]).includes(enquiry.preferredChannel ?? "") ? (enquiry.preferredChannel as FollowUpChannel) : "call",
  );
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState(() => localInputIn(2, 10));
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();

  return (
    <Dialog open onOpenChange={(open) => !busy && !open && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log a follow-up</DialogTitle>
          <DialogDescription>It resets the idle clock and appears in the client&apos;s communication log too.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When" htmlFor="fu-when">
            <Input id="fu-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Channel">
            <SimpleSelect label="Channel" value={channel} options={FOLLOW_UP_CHANNELS.map((c) => [c, FOLLOW_UP_CHANNEL_LABELS[c]])} onChange={(v) => setChannel((v as FollowUpChannel) ?? "call")} />
          </Field>
          <Field label="Outcome" htmlFor="fu-outcome" className="sm:col-span-2">
            <Input id="fu-outcome" placeholder="Spoke to Sara; wants a quote for 6 AC units" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Notes (optional)" htmlFor="fu-notes" className="sm:col-span-2">
            <Textarea id="fu-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
          <Field label="Next follow-up" htmlFor="fu-next">
            <Input id="fu-next" type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Move to stage (optional)">
            <SimpleSelect
              label="Move to stage"
              allowNone
              placeholder="Stay where it is"
              value={moveTo}
              options={meta.stages.filter((s) => s !== enquiry.stage && s !== ENQUIRY_STAGE.lost).map((s) => [s, s])}
              onChange={setMoveTo}
            />
          </Field>
        </div>
        {!next ? <p className="text-muted-foreground text-xs">With no next follow-up, the enquiry goes idle after {meta.idleDays} days.</p> : null}
        <FormError error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || outcome.trim().length < 2}
            onClick={() =>
              void run(() =>
                onSave({
                  occurredAt: fromLocalInput(when) ?? new Date().toISOString(),
                  channel,
                  outcome: outcome.trim(),
                  notes: notes.trim() || null,
                  nextFollowUpAt: fromLocalInput(next),
                  moveToStage: moveTo,
                }),
              )
            }
          >
            {busy ? "Saving…" : "Log follow-up"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Book a site visit (DEV-362)                                         */
/* ------------------------------------------------------------------ */

export function SiteVisitDialog({
  meta,
  enquiry,
  onClose,
  onSave,
}: {
  meta: EnquiryMeta;
  enquiry: EnquiryRecord;
  onClose: () => void;
  onSave: (input: { propertyId: string; scheduledAt: string; assessorId: string }) => Promise<void>;
}) {
  const [propertyId, setPropertyId] = useState<string | null>(enquiry.property?.id ?? null);
  const [when, setWhen] = useState(() => localInputIn(2, 10));
  const [assessorId, setAssessorId] = useState<string | null>(enquiry.owner?.id ?? meta.me);
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyVersion, setPropertyVersion] = useState(0);
  const { busy, error, run } = useSubmit();
  const scheduledAt = fromLocalInput(when);

  return (
    <Dialog open onOpenChange={(open) => !busy && !open && onClose()}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book a site visit</DialogTitle>
          <DialogDescription>
            An assessment of the property is opened, dated and assigned. The assessor is told in the portal and records attendance, asset counts and findings on it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Property">
            <PropertySelect customerId={enquiry.customer.id} value={propertyId} onChange={(p) => setPropertyId(p?.id ?? null)} refreshKey={propertyVersion} />
          </Field>
          <Button variant="link" className="h-auto justify-start p-0" onClick={() => setAddingProperty(true)}>
            Add a property for {enquiry.customer.name}
          </Button>
          <Field label="Date and time" htmlFor="sv-when">
            <Input id="sv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Assessor">
            <PersonSelect label="Assessor" people={meta.people} value={assessorId} onChange={setAssessorId} />
          </Field>
        </div>
        <FormError error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !propertyId || !scheduledAt || !assessorId}
            onClick={() => void run(() => onSave({ propertyId: propertyId!, scheduledAt: scheduledAt!, assessorId: assessorId! }))}
          >
            {busy ? "Booking…" : "Book site visit"}
          </Button>
        </DialogFooter>
        {addingProperty ? (
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
      </ActionDialogContent>
    </Dialog>
  );
}
