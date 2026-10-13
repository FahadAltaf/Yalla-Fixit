"use client";

import { useState } from "react";
import { BadgeCheck, IdCard, Link2, Megaphone, Pencil } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CHANNEL_LABELS, LIFECYCLE_LABELS, documentExpiryState } from "@/lib/amc/client-profile";
import { todayInDubai } from "@/lib/amc/contracts";
import type { CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";
import { clientHistoryService } from "@/modules/amc-contracts/client-history-service";
import { clientProfileService } from "@/modules/amc-contracts/client-profile-service";

import { formatContractDate, formatDateTime } from "../contract-status";
import { DetailList } from "./detail-list";
import { useDialog } from "./use-dialog";

/* Theme tokens: a prospect is in progress, a client is good, a former client is neutral. */
export const LIFECYCLE_TONE: Record<CustomerRecord["lifecycle"], string> = {
  prospect: "bg-brand-50 text-brand",
  client: "bg-success/10 text-success",
  former: "bg-mist text-ink-soft",
};

/** Identity (BRD 5.9: individual or company, trade licence, TRN), preferences, and marketing consent apart. */
export function IdentityCard({ customer, canEdit, onChanged }: { customer: CustomerRecord; canEdit: boolean; onChanged: () => void }) {
  const consent = useDialog();
  const fsm = useDialog();
  const licenceState = documentExpiryState(customer.tradeLicenseExpiry, todayInDubai(), 60);
  const company = customer.customerType !== "individual";

  const left = [
    {
      label: "Status",
      value: (
        <Badge variant="secondary" className={`border-0 font-medium ${LIFECYCLE_TONE[customer.lifecycle]}`}>
          {LIFECYCLE_LABELS[customer.lifecycle]}
        </Badge>
      ),
      hint: customer.becameClientAt ? `Client since ${formatContractDate(customer.becameClientAt.slice(0, 10))}` : null,
    },
    { label: "Type", value: customer.customerType === "company" ? "Company" : customer.customerType === "individual" ? "Individual" : null },
    { label: "Preferred channel", value: customer.preferredChannel ? CHANNEL_LABELS[customer.preferredChannel] : null },
    { label: "Preferred language", value: customer.preferredLanguage },
    {
      label: "FSM customer (Contact id)",
      value: (
        <span className="inline-flex items-center gap-1">
          {customer.fsmContactId ? <span className="font-mono text-xs">{customer.fsmContactId}</span> : <span className="text-muted-foreground font-normal">Not linked</span>}
          {canEdit ? (
            <Button size="icon" variant="ghost" className="size-7" onClick={() => fsm.show(true)} aria-label={customer.fsmContactId ? "Change the FSM contact id" : "Link an FSM contact id"}>
              {customer.fsmContactId ? <Pencil className="size-3.5" /> : <Link2 className="size-3.5" />}
            </Button>
          ) : null}
        </span>
      ),
      hint: customer.fsmContactId ? null : "Links FSM work orders to this client",
    },
  ];
  const right = company
    ? [
        {
          label: "Trade licence",
          value: customer.tradeLicenseNo ? (
            <span className="inline-flex items-center gap-2">
              {customer.tradeLicenseNo}
              {licenceState ? (
                <Badge variant="secondary" className={`border-0 font-medium ${licenceState === "expired" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}>
                  {licenceState === "expired" ? "Expired" : "Expiring"}
                </Badge>
              ) : null}
            </span>
          ) : null,
          hint: customer.tradeLicenseExpiry ? `Expires ${formatContractDate(customer.tradeLicenseExpiry)}` : null,
        },
        { label: "TRN", value: customer.trn ? <span className="tabular-nums">{customer.trn}</span> : null },
      ]
    : [];

  return (
    <SectionCard icon={<IdCard />} title="Identity and preferences" bodyClassName="px-5 pb-5">
      <div className="grid gap-x-8 sm:grid-cols-2">
        <DetailList rows={left} />
        {right.length ? <DetailList rows={right} /> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
        <div className="flex items-start gap-3">
          <Megaphone className="text-brand mt-0.5 size-4 shrink-0" />
          <div className="text-sm">
            <div className="font-medium">
              Marketing consent:{" "}
              {customer.marketingConsent === true ? "Given" : customer.marketingConsent === false ? "Refused" : "Not asked"}
            </div>
            <div className="text-muted-foreground text-xs">
              {customer.marketingConsentAt
                ? `${formatDateTime(customer.marketingConsentAt)}${customer.marketingConsentSource ? ` · ${customer.marketingConsentSource}` : ""}`
                : "Kept apart from the contact details; contract messages are not marketing."}
            </div>
          </div>
        </div>
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => consent.show(true)}>
            <BadgeCheck className="size-4" />
            Record consent
          </Button>
        ) : null}
      </div>
      <ConsentDialog
        key={consent.key}
        open={consent.open}
        onOpenChange={consent.onOpenChange}
        current={customer.marketingConsent}
        onSave={async (input) => {
          await clientProfileService.setConsent(customer.id, input);
          toast.success("Consent recorded");
          onChanged();
        }}
      />
      <FsmContactDialog
        key={`fsm-${fsm.key}`}
        open={fsm.open}
        onOpenChange={fsm.onOpenChange}
        current={customer.fsmContactId}
        onSave={async (fsmContactId) => {
          await clientHistoryService.setFsmContact(customer, fsmContactId);
          toast.success(fsmContactId ? "FSM customer linked" : "FSM customer unlinked");
          onChanged();
        }}
      />
    </SectionCard>
  );
}

/** The FSM customer (Contact id) behind the profile (BRD 5.9), entered by hand until FSM sync. */
function FsmContactDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string | null;
  onSave: (fsmContactId: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const next = value.trim() || null;
  const save = async () => {
    setBusy(true);
    try {
      await onSave(next);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the FSM customer.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>FSM customer</DialogTitle>
          <DialogDescription>The client&apos;s Contact id in FSM. AMC uses it to match FSM work orders and appointments to this client&apos;s contracts.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label htmlFor="fsm-contact-id">FSM customer (Contact id)</Label>
          <Input id="fsm-contact-id" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className="font-mono" placeholder="e.g. 3a6f0c2e-…" autoComplete="off" />
          <p className="text-muted-foreground text-xs">Leave empty to unlink.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" icon={<Link2 className="size-4" />} disabled={next === (current ?? null)}>
            Save
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function ConsentDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: boolean | null;
  onSave: (input: { consent: boolean; source: string }) => Promise<void>;
}) {
  const [consent, setConsent] = useState<"yes" | "no">(current === false ? "no" : "yes");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ consent: consent === "yes", source: source.trim() });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the consent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marketing consent</DialogTitle>
          <DialogDescription>Records the client&apos;s answer with the date, how it was given and who recorded it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <RadioGroup value={consent} onValueChange={(v) => setConsent(v as "yes" | "no")} className="grid gap-2">
            <Label className="flex items-center gap-2 font-normal">
              <RadioGroupItem value="yes" /> The client agrees to receive marketing
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <RadioGroupItem value="no" /> The client does not want marketing
            </Label>
          </RadioGroup>
          <div className="grid gap-1.5">
            <Label htmlFor="consent-source">How it was given</Label>
            <Input id="consent-source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} placeholder="e.g. Signed form, WhatsApp reply, phone call" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…" icon={<BadgeCheck className="size-4" />} disabled={!source.trim()}>
            Record consent
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
