"use client";

import { useState } from "react";
import { BadgeCheck, IdCard, Megaphone } from "lucide-react";
import { toast } from "sonner";

import { DataRow, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CHANNEL_LABELS, LIFECYCLE_LABELS, documentExpiryState } from "@/lib/amc/client-profile";
import { todayInDubai } from "@/lib/amc/contracts";
import type { CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";
import { clientProfileService } from "@/modules/amc-contracts/client-profile-service";

import { formatContractDate, formatDateTime } from "../contract-status";

export const LIFECYCLE_TONE: Record<CustomerRecord["lifecycle"], string> = {
  prospect: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  client: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  former: "bg-muted text-muted-foreground",
};

/** Identity (BRD 5.9: individual or company, trade licence, TRN), preferences, and marketing consent apart. */
export function IdentityCard({ customer, canEdit, onChanged }: { customer: CustomerRecord; canEdit: boolean; onChanged: () => void }) {
  const [consentOpen, setConsentOpen] = useState(false);
  const licenceState = documentExpiryState(customer.tradeLicenseExpiry, todayInDubai(), 60);

  return (
    <SectionCard icon={<IdCard />} title="Identity and preferences" bodyClassName="px-5 pb-5">
      <div className="grid gap-x-6 sm:grid-cols-2">
        <DataRow
          title="Status"
          subtitle={customer.becameClientAt ? `Client since ${formatContractDate(customer.becameClientAt.slice(0, 10))}` : undefined}
          trailing={
            <Badge variant="secondary" className={`border-none ${LIFECYCLE_TONE[customer.lifecycle]}`}>
              {LIFECYCLE_LABELS[customer.lifecycle]}
            </Badge>
          }
        />
        <DataRow title="Type" trailing={<span className="text-sm">{customer.customerType === "company" ? "Company" : customer.customerType === "individual" ? "Individual" : "—"}</span>} />
        {customer.customerType !== "individual" ? (
          <>
            <DataRow
              title="Trade licence"
              subtitle={customer.tradeLicenseExpiry ? `Expires ${formatContractDate(customer.tradeLicenseExpiry)}` : undefined}
              trailing={
                <span className="flex items-center gap-2 text-sm">
                  {customer.tradeLicenseNo ?? "—"}
                  {licenceState ? (
                    <Badge variant="secondary" className={`border-none ${licenceState === "expired" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                      {licenceState === "expired" ? "Expired" : "Expiring"}
                    </Badge>
                  ) : null}
                </span>
              }
            />
            <DataRow title="TRN" trailing={<span className="text-sm tabular-nums">{customer.trn ?? "—"}</span>} />
          </>
        ) : null}
        <DataRow title="Preferred channel" trailing={<span className="text-sm">{customer.preferredChannel ? CHANNEL_LABELS[customer.preferredChannel] : "—"}</span>} />
        <DataRow title="Preferred language" trailing={<span className="text-sm">{customer.preferredLanguage ?? "—"}</span>} />
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
          <Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>
            <BadgeCheck className="size-4" />
            Record consent
          </Button>
        ) : null}
      </div>
      {consentOpen ? (
        <ConsentDialog
          current={customer.marketingConsent}
          onClose={() => setConsentOpen(false)}
          onSave={async (input) => {
            await clientProfileService.setConsent(customer.id, input);
            toast.success("Consent recorded");
            setConsentOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function ConsentDialog({
  current,
  onClose,
  onSave,
}: {
  current: boolean | null;
  onClose: () => void;
  onSave: (input: { consent: boolean; source: string }) => Promise<void>;
}) {
  const [consent, setConsent] = useState<"yes" | "no">(current === false ? "no" : "yes");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ consent: consent === "yes", source: source.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marketing consent</DialogTitle>
          <DialogDescription>Recorded with the date, how it was given and who recorded it.</DialogDescription>
        </DialogHeader>
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
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !source.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
