"use client";

import { useId, useState } from "react";
import { ChevronDown, Hammer, Search } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PARTY_ROLE_LABELS,
  PARTY_ROLES,
  WORK_PARTIES,
  WORK_PARTY_LABELS,
  WORK_RISK_LABELS,
  WORK_RISKS,
  type WorkParty,
  type WorkPartyValue,
  type WorkRisk,
} from "@/lib/amc/call-outs";
import { TRADE_LABELS, TRADES } from "@/lib/amc/client-profile";
import type { Trade } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";
import { additionalWorksService, type WorkCrewSuggestion } from "@/modules/amc-contracts/additional-works-service";

import { ContractPicker, Field, errorText, type PickedContract } from "./call-out-shared";
import { TechnicianSelect } from "./people-pickers";
import { useBookingGuards } from "./booking-guards";
import { AmcPhoneInput } from "@/components/dashboard/extensions/amc/components/amc-phone-input";

import { CrewPicker, crewOptions, crewSummary } from "./crew-picker";
import { useLeadTimeConfirm } from "./lead-time-confirm";
import { formatContractDate } from "./contract-status";
import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
import { todayInDubai } from "@/lib/amc/contracts";
const NONE = "__none";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PartyRole = (typeof PARTY_ROLES)[number];
export type PartyDraft = { name: string; role: PartyRole; email: string; phone: string };
export type PartyDrafts = Record<WorkParty, PartyDraft>;

const emptyParty = (): PartyDraft => ({ name: "", role: "other", email: "", phone: "" });

/* The Parties section of the dialog (requester, approver, payer ...): hidden for now (18 Nov 2026). */
const SHOW_PARTIES = false;

export function partyDrafts(values?: Partial<Record<WorkParty, WorkPartyValue | null>> | null): PartyDrafts {
  return Object.fromEntries(
    WORK_PARTIES.map((p) => {
      const v = values?.[p];
      return [p, v ? { name: v.name ?? "", role: (v.role as PartyRole) ?? "other", email: v.email ?? "", phone: v.phone ?? "" } : emptyParty()];
    }),
  ) as PartyDrafts;
}

/** A party with no name is left out (or cleared), so the server uses the client. */
export function partiesInput(drafts: PartyDrafts, clearEmpty: boolean) {
  const out: Partial<Record<WorkParty, { name: string; role: PartyRole; email: string | null; phone: string | null } | null>> = {};
  for (const p of WORK_PARTIES) {
    const d = drafts[p];
    if (d.name.trim()) out[p] = { name: d.name.trim(), role: d.role, email: d.email.trim() || null, phone: d.phone.trim() || null };
    else if (clearEmpty) out[p] = null;
  }
  return out;
}

export function partiesProblem(drafts: PartyDrafts): string | null {
  for (const p of WORK_PARTIES) {
    const d = drafts[p];
    if (!d.name.trim() && (d.email.trim() || d.phone.trim())) return `${WORK_PARTY_LABELS[p]}: add a name, or clear the details.`;
    if (d.email.trim() && !EMAIL.test(d.email.trim())) return `${WORK_PARTY_LABELS[p]}: the email address does not look right.`;
  }
  return null;
}

/** The five parties (BRD 5.14), one row each; an empty row means "the client". */
export function PartiesEditor({ value, onChange, disabled }: { value: PartyDrafts; onChange: (next: PartyDrafts) => void; disabled?: boolean }) {
  const base = useId();
  const set = (p: WorkParty, next: Partial<PartyDraft>) => onChange({ ...value, [p]: { ...value[p], ...next } });
  return (
    <div className="grid gap-3">
      {WORK_PARTIES.map((p) => {
        const d = value[p];
        const id = `${base}-${p}`;
        return (
          <fieldset key={p} className="grid gap-2 rounded-lg border px-3 py-3">
            <legend className="px-1 text-sm font-medium">{WORK_PARTY_LABELS[p]}</legend>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Input
                id={`${id}-name`}
                aria-label={`${WORK_PARTY_LABELS[p]} name`}
                placeholder="Same as the client"
                maxLength={160}
                disabled={disabled}
                value={d.name}
                onChange={(e) => set(p, { name: e.target.value })}
              />
              <Select value={d.role} disabled={disabled} onValueChange={(r) => set(p, { role: r as PartyRole })}>
                <SelectTrigger aria-label={`${WORK_PARTY_LABELS[p]} role`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTY_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {PARTY_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                id={`${id}-email`}
                type="email"
                aria-label={`${WORK_PARTY_LABELS[p]} email`}
                placeholder="Email"
                maxLength={200}
                disabled={disabled}
                value={d.email}
                onChange={(e) => set(p, { email: e.target.value })}
              />
              <AmcPhoneInput
                id={`${id}-phone`}
                ariaLabel={`${WORK_PARTY_LABELS[p]} phone`}
                disabled={disabled}
                value={d.phone}
                onChange={(phone) => set(p, { phone })}
              />
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Raise additional work (Phase 11: DEV-407) from a PPM visit, a call out,
 * or by hand: the technical finding, its risk and trade, and who requests,
 * approves, pays and receives the invoice and report. Parties left empty
 * are the client. Mount it with a `key` that changes on every open.
 */
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function RaiseAdditionalWorkDialog({
  open,
  onOpenChange,
  contractId,
  source,
  visitId,
  callOutId,
  initialFinding,
  initialTrade,
  initialTechnicianId,
  context,
  onRaised,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Left out (manual): a contract is picked in the dialog. */
  contractId?: string | null;
  source: "visit" | "call_out" | "manual";
  visitId?: string | null;
  callOutId?: string | null;
  initialFinding?: string;
  initialTrade?: string | null;
  /** The visit's or call out's lead technician, when there is one. */
  initialTechnicianId?: string | null;
  /** "Call out CO-0012", "Visit 3": where it was found. */
  context?: string;
  onRaised?: (work: { id: string; workNo: string }) => unknown;
}) {
  const { guard, dialogs: bookingDialogs } = useBookingGuards();
  const [picked, setPicked] = useState<PickedContract | null>(null);
  const [finding, setFinding] = useState(initialFinding ?? "");
  const [risk, setRisk] = useState<WorkRisk>("low");
  const [trade, setTrade] = useState<Trade | null>(initialTrade && (TRADES as readonly string[]).includes(initialTrade) ? (initialTrade as Trade) : null);
  const [technicianId, setTechnicianId] = useState<string | null>(initialTechnicianId ?? null);
  const [parties, setParties] = useState<PartyDrafts>(() => partyDrafts());
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = { contract: useId(), finding: useId(), risk: useId(), trade: useId(), technician: useId(), date: useId(), time: useId(), duration: useId(), override: useId() };
  /*
    27 Nov 2026 (the user): the crew as Crew & time picks it -- a day and a
    time, then Find technicians, then choose -- so the work can be planned
    as it is raised. Optional: left empty, it is scheduled later.
  */
  const { guard: leadTimeGuard, dialog: leadTimeDialog } = useLeadTimeConfirm();
  const [date, setDate] = useState(() => todayInDubai());
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("120");
  const [suggestion, setSuggestion] = useState<{ key: string; data: WorkCrewSuggestion } | null>(null);
  const [crew, setCrew] = useState<string[]>([]);
  const [missingLogins, setMissingLogins] = useState(0);
  const [crewReason, setCrewReason] = useState("");
  const [finding_, setFinding_] = useState(false);

  const targetId = contractId ?? picked?.id ?? null;
  const minutes = Number(duration);
  const validSlot = isIsoDate(date) && /^\d{2}:\d{2}$/.test(time) && Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440;
  const slotKey = `${targetId}|${trade ?? ""}|${date}|${time}|${minutes}`;
  const fresh = suggestion?.key === slotKey ? suggestion.data : null;
  const options = fresh ? crewOptions(fresh) : null;
  const suggestedIds = fresh?.suggested.technicianIds ?? [];
  const crewDiffers = fresh !== null && crew.length > 0 && !(crew.length === suggestedIds.length && crew.every((c) => suggestedIds.includes(c)));
  const reasonRequired = crewDiffers && suggestedIds.length > 0;
  const planning = fresh !== null && crew.length > 0;
  const problem = !targetId
    ? "Choose the contract."
    : finding.trim().length < 3
      ? "Describe the finding."
      : planning && reasonRequired && crewReason.trim().length < 3
        ? "Say why this crew was chosen instead of the suggested one."
        : planning && missingLogins > 0
          ? "Create the mobile logins of the chosen crew first."
          : partiesProblem(parties);

  const findCrew = async () => {
    if (!targetId || !validSlot) return;
    setFinding_(true);
    try {
      const result = await additionalWorksService.suggestForContract(targetId, trade, date, time, minutes);
      setSuggestion({ key: slotKey, data: result });
      setCrew(result.suggested.technicianIds);
      setCrewReason("");
      if (!result.fits.some((f) => f.blockers.length === 0)) toast.warning("Nobody can be picked at that time: everyone is on leave or cannot take this work.");
    } catch (e) {
      toast.error(errorText(e, "Could not find technicians."));
    } finally {
      setFinding_(false);
    }
  };

  const submit = async () => {
    if (problem || !targetId) return;
    setBusy(true);
    try {
      const result = await guard((answers) => additionalWorksService.create({
        contractId: targetId,
        expiredReason: answers.expiredReason ?? null,
        source,
        visitId: source === "visit" ? visitId : null,
        callOutId: source === "call_out" ? callOutId : null,
        technicianId: technicianId?.trim() || null,
        trade,
        finding: finding.trim(),
        risk,
        parties: partiesInput(parties, false),
      }));
      toast.success(`Additional work ${result.workNo} raised`);
      /* Planned on the slot and crew chosen here, as Crew & time would. */
      if (planning) {
        try {
          await leadTimeGuard((insideLeadTime) =>
            additionalWorksService.action(result.id, {
              action: "schedule",
              date,
              time,
              durationMinutes: minutes,
              technicianIds: crew,
              overrideReason: crewReason.trim() || null,
              insideLeadTime,
            }),
          );
          toast.success(`${result.workNo} planned for ${formatContractDate(date)} at ${time}`);
        } catch (e) {
          toast.warning(`${result.workNo} was raised but not planned`, { description: errorText(e, "Plan it on its Crew & time tab.") });
        }
      }
      onOpenChange(false);
      await onRaised?.(result);
    } catch (e) {
      toast.error(errorText(e, "Could not raise the additional work."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        {bookingDialogs}
        {leadTimeDialog}
        <DialogHeader>
          <DialogTitle>Raise additional work</DialogTitle>
          <DialogDescription>
            {context ? `Found on ${context}. ` : ""}Work outside the contract, quoted to the client separately. The finding stays apart from the quotation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!contractId ? (
            <Field id={ids.contract} label="Contract">
              <ContractPicker id={ids.contract} value={picked} onChange={setPicked} disabled={busy} />
            </Field>
          ) : null}
          <Field id={ids.finding} label="Finding">
            <Textarea id={ids.finding} rows={4} maxLength={4000} placeholder="What was found, where, and why it needs doing" value={finding} onChange={(e) => setFinding(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={ids.risk} label="Risk">
              <Select value={risk} onValueChange={(v) => setRisk(v as WorkRisk)}>
                <SelectTrigger id={ids.risk} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_RISKS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {WORK_RISK_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={ids.trade} label="Trade">
              <Select value={trade ?? NONE} onValueChange={(v) => setTrade(v === NONE ? null : (v as Trade))}>
                <SelectTrigger id={ids.trade} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {TRADES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRADE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={ids.technician} label="Found by (optional)">
              <TechnicianSelect id={ids.technician} value={technicianId} onChange={setTechnicianId} disabled={busy} />
            </Field>
          </div>

          <div className="grid gap-3 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Schedule (optional)</p>
              <p className="text-muted-foreground text-xs">Pick a day and time, then find who is competent for the trade and free. Left empty, it is scheduled later on Crew &amp; time.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id={ids.date} label="Date">
                <DateSelect id={ids.date} value={date} onChange={setDate} />
              </Field>
              <Field id={ids.time} label="Start time">
                <TimeSelect id={ids.time} step={900} value={time} onChange={setTime} />
              </Field>
              <Field id={ids.duration} label="Duration (minutes)">
                <Input id={ids.duration} type="number" min={15} max={1440} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                {!targetId
                  ? "Choose the contract first."
                  : suggestion && !fresh
                    ? "The day, time or trade changed: find technicians again."
                    : !validSlot
                      ? "Enter a date, a start time and 15 to 1440 minutes."
                      : !fresh
                        ? `Then choose the crew${trade ? "" : " (with no trade set, every technician is offered)"}.`
                        : crewSummary(crew)}
              </p>
              <SubmitButton variant="outline" pending={finding_} pendingLabel="Finding…" disabled={busy || finding_ || !targetId || !validSlot} icon={<Search className="size-4" />} onClick={() => void findCrew()}>
                Find technicians
              </SubmitButton>
            </div>
            {options ? <CrewPicker options={options} picked={crew} onPickedChange={setCrew} disabled={busy} onMissingLoginsChange={setMissingLogins} /> : null}
            {crewDiffers ? (
              <Field id={ids.override} label={reasonRequired ? "Why this crew" : "Why this crew (optional)"}>
                <Textarea id={ids.override} rows={2} maxLength={500} value={crewReason} onChange={(e) => setCrewReason(e.target.value)} />
              </Field>
            ) : null}
          </div>

          {/* Hidden for now (18 Nov 2026): the client is every party unless changed on the work's Parties tab. */}
          {SHOW_PARTIES ? (
          <Collapsible open={partiesOpen} onOpenChange={setPartiesOpen} className="rounded-lg border">
            <CollapsibleTrigger asChild>
              <button type="button" className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span>
                  <span className="block text-sm font-medium">Parties</span>
                  <span className="text-muted-foreground block text-xs">
                    Requester, approver, payer, invoice and report recipients. Leave a row empty for the client.
                  </span>
                </span>
                <ChevronDown className={cn("text-muted-foreground size-4 shrink-0 transition-transform", partiesOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-4 py-3">
              <PartiesEditor value={parties} onChange={setParties} disabled={busy} />
            </CollapsibleContent>
          </Collapsible>
          ) : null}
        </div>

        <DialogFooter className="sm:items-center">
          {problem ? <p className="text-muted-foreground order-last text-xs sm:order-first sm:mr-auto">{problem}</p> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} pendingLabel="Raising…" disabled={Boolean(problem)} icon={<Hammer className="size-4" />} onClick={() => void submit()}>
            Raise additional work
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
