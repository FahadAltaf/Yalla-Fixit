"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { checkUsage, formatQuantity, todayInDubai, unitWord, usagePreview } from "@/lib/amc/contracts";
import { amcContractsService, type ContractDetail } from "@/modules/amc-contracts/amc-contracts-service";

import { formatContractDate } from "./contract-status";

type Entitlement = ContractDetail["entitlements"][number];

/**
 * Records usage of one contracted service: a visit, hours or a call-out.
 * Shows what the entry does to the allowance before it is saved. Entries
 * are never edited afterwards; a mistake is corrected from the history.
 * Informational services are covered but not counted, so they are not
 * offered. The server and the database apply the same limits as this form.
 */
export function RecordUsageDialog({
  open,
  onOpenChange,
  contract,
  entitlements,
  initialEntitlementId,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: ContractDetail["contract"];
  entitlements: Entitlement[];
  initialEntitlementId?: string | null;
  onRecorded: () => void;
}) {
  const consumable = entitlements.filter((e) => e.consumable);
  const firstOpen = consumable.find((e) => e.remainingQuantity === null || e.remainingQuantity > 0);
  const [entitlementId, setEntitlementId] = useState(initialEntitlementId ?? firstOpen?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState(todayInDubai());
  const [refType, setRefType] = useState<"none" | "fsm_work_order" | "fsm_appointment">("none");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEntitlementId(initialEntitlementId ?? firstOpen?.id ?? "");
      setQuantity("1");
      setDate(todayInDubai());
      setRefType("none");
      setReference("");
      setNotes("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, initialEntitlementId]);

  const entitlement = consumable.find((e) => e.id === entitlementId);
  const qty = Number(quantity);
  const check = entitlement
    ? checkUsage({ contract, entitlement, kind: "consumption", quantity: qty, occurredAt: date, notes })
    : null;
  const preview = entitlement && quantity !== "" && Number.isFinite(qty) ? usagePreview(entitlement, qty) : null;
  const refMissing = refType !== "none" && !reference.trim();

  const submit = async () => {
    if (!entitlement || !check?.ok) {
      setError(check && !check.ok ? check.error : "Choose a service.");
      return;
    }
    if (refMissing) {
      setError("Enter the reference, or choose None.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await amcContractsService.recordUsage(contract.id, {
        entitlementId: entitlement.id,
        quantity: check.quantity,
        occurredAt: date,
        externalType: refType === "none" ? null : refType,
        externalReference: refType === "none" ? null : reference.trim(),
        notes: notes.trim() || null,
      });
      toast.success("Usage recorded");
      onOpenChange(false);
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the usage.");
    } finally {
      setBusy(false);
    }
  };

  const unit = entitlement ? unitWord(entitlement.entitlementType, 2) || "call-outs" : "";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record usage</DialogTitle>
          <DialogDescription>
            Count a visit, hours or a call-out against AMC {contract.proposalNumber}. Covered from{" "}
            {formatContractDate(contract.startDate)} to {formatContractDate(contract.endDate)}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="amc-usage-service">Service</Label>
            <Select value={entitlementId} onValueChange={setEntitlementId}>
              <SelectTrigger id="amc-usage-service">
                <SelectValue placeholder="Choose a service" />
              </SelectTrigger>
              <SelectContent>
                {consumable.map((e) => (
                  <SelectItem
                    key={e.id}
                    value={e.id}
                    disabled={e.remainingQuantity !== null && e.remainingQuantity <= 0}
                  >
                    {e.serviceLabel} · {e.remainingQuantity !== null && e.remainingQuantity <= 0 ? "used up" : e.usageLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="amc-usage-qty">Quantity{unit ? ` (${unit})` : ""}</Label>
              <Input
                id="amc-usage-qty"
                type="number"
                inputMode="decimal"
                min={0}
                step={entitlement?.entitlementType === "hours" ? "0.25" : "1"}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amc-usage-date">Date of the work</Label>
              <DatePickerField id="amc-usage-date" value={date} onChange={setDate} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="amc-usage-ref-type">FSM reference</Label>
              <Select value={refType} onValueChange={(v) => setRefType(v as typeof refType)}>
                <SelectTrigger id="amc-usage-ref-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="fsm_work_order">Work order</SelectItem>
                  <SelectItem value="fsm_appointment">Appointment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amc-usage-ref">Reference</Label>
              <Input
                id="amc-usage-ref"
                placeholder={refType === "fsm_appointment" ? "e.g. SA-1042" : "e.g. WO731"}
                value={reference}
                disabled={refType === "none"}
                maxLength={100}
                onChange={(event) => setReference(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amc-usage-notes">Notes (optional)</Label>
            <Textarea
              id="amc-usage-notes"
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {preview ? (
            <dl className="bg-muted/40 grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
              <PreviewCell label="Included" value={preview.unlimited ? "Unlimited" : formatQuantity(preview.included ?? 0)} />
              <PreviewCell label="Already used" value={formatQuantity(preview.used)} />
              <PreviewCell label="Recording" value={formatQuantity(preview.recording)} />
              <PreviewCell
                label="Remaining after"
                value={preview.unlimited ? "Unlimited" : formatQuantity(preview.remainingAfter ?? 0)}
                danger={!preview.unlimited && (preview.remainingAfter ?? 0) < 0}
              />
            </dl>
          ) : null}

          {error || (check && !check.ok && quantity !== "") ? (
            <p className="text-destructive text-sm" role="alert">
              {error ?? (check && !check.ok ? check.error : "")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !check?.ok || refMissing}>
            {busy ? "Saving…" : "Record usage"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function PreviewCell({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={`font-medium tabular-nums ${danger ? "text-destructive" : ""}`}>{value}</dd>
    </div>
  );
}
