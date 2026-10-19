"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, ExternalLink, PhoneCall, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import DateTimeSelect from "@/components/ui/date-time-select";
import { useDebounce } from "@/hooks/use-debounce";
import { CALL_OUT_CHANNEL_LABELS, CALL_OUT_CHANNELS, CALL_OUT_PRIORITIES, CALL_OUT_PRIORITY_LABELS, type CallOutChannel, type CallOutPriority } from "@/lib/amc/call-outs";
import { TRADE_LABELS, TRADES } from "@/lib/amc/client-profile";
import type { Trade } from "@/lib/amc/visits";
import { callOutsService, type CoverageResponse, type CreateCallOutResult } from "@/modules/amc-contracts/call-outs-service";

import { ContractPicker, CoverageBadge, Field, PreparedMessage, errorText, fromLocalInput, nowLocalInput, shortDateTime, type PickedContract } from "./call-out-shared";

const NONE = "__none";

type Preview = { key: string; data: CoverageResponse | null; error: string | null; fetchedAt: number };

/**
 * Log a call out (Phase 11: DEV-405, 408): the contract, priority,
 * channel, when the client called, the issue and who is on site. The
 * coverage answer re-runs as the inputs change and shows before anything
 * is confirmed: covered or chargeable, why, the allowance balance and the
 * SLA deadline. A chargeable one may be booked as covered with a reason
 * (AMC Allowances (Approve)). After logging, the acknowledgement is ready
 * to send on WhatsApp.
 *
 * Mount it with a `key` that changes on every open, so it starts empty.
 */
export function LogCallOutDialog({
  open,
  onOpenChange,
  contractId,
  onLogged,
  onOpenCallOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from a contract: logged on that contract. */
  contractId?: string | null;
  onLogged?: () => unknown;
  /** Offer "Open call out" after logging. */
  onOpenCallOut?: (id: string) => void;
}) {
  const [picked, setPicked] = useState<PickedContract | null>(null);
  const [priority, setPriority] = useState<CallOutPriority>("non_emergency");
  const [channel, setChannel] = useState<CallOutChannel>("call");
  const [reportedAt, setReportedAt] = useState(() => nowLocalInput());
  const [issue, setIssue] = useState("");
  const [trade, setTrade] = useState<Trade | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [partsExpected, setPartsExpected] = useState(false);
  const [partsValue, setPartsValue] = useState("");
  const [excluded, setExcluded] = useState(false);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CreateCallOutResult | null>(null);
  const [acked, setAcked] = useState(false);
  const [acking, setAcking] = useState(false);
  const ids = {
    contract: useId(),
    priority: useId(),
    channel: useId(),
    reported: useId(),
    issue: useId(),
    trade: useId(),
    contactName: useId(),
    contactPhone: useId(),
    parts: useId(),
    partsValue: useId(),
    excluded: useId(),
    override: useId(),
    overrideReason: useId(),
  };

  const targetId = contractId ?? picked?.id ?? null;
  const partsValueAed = partsExpected && partsValue.trim() !== "" && Number.isFinite(Number(partsValue)) ? Math.max(0, Number(partsValue)) : null;
  const query = useMemo(
    () => (targetId ? JSON.stringify({ contractId: targetId, priority, partsExpected, partsValueAed, excluded }) : null),
    [targetId, priority, partsExpected, partsValueAed, excluded],
  );
  const debounced = useDebounce(query, 350);

  /* The coverage answer for the current inputs; the last one stays on screen while the next loads. */
  useEffect(() => {
    if (!open || !debounced) return;
    let stale = false;
    callOutsService.coverage(JSON.parse(debounced)).then(
      (data) => !stale && setPreview({ key: debounced, data, error: null, fetchedAt: Date.now() }),
      (e) => !stale && setPreview({ key: debounced, data: null, error: errorText(e, "Could not check the coverage."), fetchedAt: Date.now() }),
    );
    return () => {
      stale = true;
    };
  }, [open, debounced]);

  const fresh = preview && preview.key === query ? preview : null;
  const shown = preview && query && JSON.parse(preview.key).contractId === targetId ? preview : null;
  const p = shown?.data ?? null;
  const reportedIso = fromLocalInput(reportedAt);
  const canBookCovered = Boolean(fresh?.data && fresh.data.coverage === "chargeable" && fresh.data.canOverride);
  const overriding = canBookCovered && override;

  /* The deadline counts from the call: the preview's window, moved to the reported time. */
  const slaDue = (() => {
    if (!shown?.data || !reportedIso) return null;
    const due = shown.data.sla.attendDueAt ?? shown.data.sla.scheduleDueAt;
    if (!due) return null;
    const windowMs = Math.round((Date.parse(due) - shown.fetchedAt) / 60_000) * 60_000;
    return new Date(Date.parse(reportedIso) + windowMs).toISOString();
  })();

  const problems = [
    !targetId ? "Choose the contract." : null,
    !reportedIso ? "Enter when the client called." : null,
    issue.trim().length < 3 ? "Describe the issue." : null,
    partsExpected && partsValue.trim() !== "" && !(Number(partsValue) >= 0) ? "Enter the parts estimate as a number." : null,
    overriding && overrideReason.trim().length < 3 ? "Say why it is booked as covered." : null,
    !fresh?.data ? "Wait for the coverage answer." : null,
  ].filter((x): x is string => Boolean(x));

  const submit = async () => {
    if (problems.length || !targetId || !reportedIso) return;
    if (Date.parse(reportedIso) > Date.now() + 5 * 60_000) return void toast.error("The call cannot be in the future.");
    setBusy(true);
    try {
      const result = await callOutsService.create({
        contractId: targetId,
        priority,
        channel,
        reportedAt: reportedIso,
        issue: issue.trim(),
        trade,
        onSiteContactName: contactName.trim() || null,
        onSiteContactPhone: contactPhone.trim() || null,
        partsExpected,
        partsValueAed,
        excluded,
        overrideReason: overriding ? overrideReason.trim() : null,
      });
      toast.success(`Call out ${result.callOutNo} logged`, {
        description: `${result.coverage === "covered" ? "Covered" : "Chargeable"}${result.reserved ? ", one unit of the allowance booked" : ""}.`,
      });
      if (result.loggedInTime === false) toast.warning("This emergency was logged later than the SLA allows after the call.");
      setDone(result);
      await onLogged?.();
    } catch (e) {
      toast.error(errorText(e, "Could not log the call out."));
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async () => {
    if (!done) return;
    setAcking(true);
    try {
      await callOutsService.action(done.id, { action: "acknowledged" });
      setAcked(true);
      toast.success("Acknowledgement recorded as sent");
      await onLogged?.();
    } catch (e) {
      toast.error(errorText(e, "Could not record the acknowledgement."));
    } finally {
      setAcking(false);
    }
  };

  const locked = busy || acking;

  return (
    <Dialog open={open} onOpenChange={(next) => !locked && onOpenChange(next)}>
      <ActionDialogContent busy={locked} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{done ? `Call out ${done.callOutNo} logged` : "Log call out"}</DialogTitle>
          <DialogDescription>
            {done
              ? "Send the client the acknowledgement, then mark it as sent."
              : "What the client reported. The coverage answer below updates as you go; tell the client before the visit."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="grid gap-4">
            <div className="grid gap-2 rounded-lg border px-4 py-3">
              <CoverageBadge coverage={done.coverage} reserved={done.reserved} />
              <ul className="text-sm">
                {[...done.reasons, ...done.chargeableExtras].map((r, i) => (
                  <li key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <PreparedMessage title="The acknowledgement" message={done.message} whatsapp={done.whatsapp}>
              <SubmitButton
                size="sm"
                variant="outline"
                pending={acking}
                pendingLabel="Saving…"
                disabled={acked}
                icon={<CheckCheck className="size-3.5" />}
                onClick={() => void acknowledge()}
              >
                {acked ? "Marked as sent" : "Mark as sent"}
              </SubmitButton>
            </PreparedMessage>
          </div>
        ) : (
          <div className="grid gap-4">
            <Field id={ids.contract} label="Contract">
              {contractId ? (
                <div className="rounded-lg border px-3 py-2 text-sm">
                  {p ? (
                    <>
                      <span className="font-medium">{p.contract.number}</span> · {p.contract.customerName || "Client"}
                      {p.contract.propertyLabel ? <span className="text-muted-foreground block truncate text-xs">{p.contract.propertyLabel}</span> : null}
                    </>
                  ) : shown?.error ? (
                    <span className="text-muted-foreground">This contract</span>
                  ) : (
                    <Skeleton className="h-5 w-48" />
                  )}
                </div>
              ) : (
                <ContractPicker id={ids.contract} value={picked} onChange={setPicked} disabled={busy} />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id={ids.priority} label="Priority">
                <Select value={priority} onValueChange={(v) => setPriority(v as CallOutPriority)}>
                  <SelectTrigger id={ids.priority} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_OUT_PRIORITIES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {CALL_OUT_PRIORITY_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={ids.channel} label="Channel">
                <Select value={channel} onValueChange={(v) => setChannel(v as CallOutChannel)}>
                  <SelectTrigger id={ids.channel} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_OUT_CHANNELS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {CALL_OUT_CHANNEL_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={ids.reported} label="Client called at">
                <DateTimeSelect id={ids.reported} value={reportedAt} onChange={setReportedAt} />
              </Field>
            </div>

            <Field id={ids.issue} label="Issue">
              <Textarea id={ids.issue} rows={3} maxLength={2000} placeholder="What the client reported" value={issue} onChange={(e) => setIssue(e.target.value)} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field id={ids.trade} label="Trade" hint="Needed to find competent technicians.">
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
              <Field id={ids.contactName} label="On-site contact (optional)">
                <Input id={ids.contactName} maxLength={120} value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </Field>
              <Field id={ids.contactPhone} label="Contact phone (optional)" hint="The acknowledgement goes here, else to the client.">
                <Input id={ids.contactPhone} type="tel" maxLength={40} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-3 rounded-lg border px-4 py-3">
              <div className="flex items-center gap-3">
                <Checkbox id={ids.parts} checked={partsExpected} onCheckedChange={(on) => setPartsExpected(on === true)} />
                <Label htmlFor={ids.parts} className="font-normal">
                  Parts beyond consumables are expected
                </Label>
              </div>
              {partsExpected ? (
                <Field id={ids.partsValue} label="Estimated parts value, AED (optional)">
                  <Input id={ids.partsValue} type="number" min={0} step="any" className="sm:w-48" value={partsValue} onChange={(e) => setPartsValue(e.target.value)} />
                </Field>
              ) : null}
              <div className="flex items-start gap-3">
                <Checkbox id={ids.excluded} className="mt-0.5" checked={excluded} onCheckedChange={(on) => setExcluded(on === true)} />
                <div className="grid gap-1">
                  <Label htmlFor={ids.excluded} className="font-normal">
                    Excluded by the contract
                  </Label>
                  <p className="text-muted-foreground text-xs">{p?.exclusions ? `Exclusions: ${p.exclusions}` : "The contract lists no exclusions for this service."}</p>
                </div>
              </div>
            </div>

            <CoveragePanel
              loading={Boolean(targetId) && !fresh}
              preview={shown}
              slaDue={slaDue}
              priority={priority}
              hasContract={Boolean(targetId)}
            />

            {canBookCovered ? (
              <div className="border-warning/30 bg-warning/5 grid gap-3 rounded-lg border px-4 py-3">
                <div className="flex items-center gap-3">
                  <Checkbox id={ids.override} checked={override} onCheckedChange={(on) => setOverride(on === true)} />
                  <Label htmlFor={ids.override} className="font-normal">
                    Book as covered anyway
                  </Label>
                </div>
                {override ? (
                  <Field id={ids.overrideReason} label="Why" hint="Recorded with your name in the audit trail.">
                    <Textarea id={ids.overrideReason} rows={2} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="sm:items-center">
          {done ? (
            <>
              {onOpenCallOut ? (
                <Button variant="outline" disabled={locked} onClick={() => onOpenCallOut(done.id)}>
                  <ExternalLink className="size-4" />
                  Open call out
                </Button>
              ) : null}
              <Button disabled={locked} onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              {problems.length ? <p className="text-muted-foreground order-last text-xs sm:order-first sm:mr-auto">{problems[0]}</p> : null}
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <SubmitButton
                pending={busy}
                pendingLabel="Logging…"
                disabled={problems.length > 0}
                icon={overriding ? <ShieldCheck className="size-4" /> : <PhoneCall className="size-4" />}
                onClick={() => void submit()}
              >
                {overriding ? "Log as covered" : "Log call out"}
              </SubmitButton>
            </>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** The coverage answer, before confirming. */
function CoveragePanel({
  loading,
  preview,
  slaDue,
  priority,
  hasContract,
}: {
  loading: boolean;
  preview: Preview | null;
  slaDue: string | null;
  priority: CallOutPriority;
  hasContract: boolean;
}) {
  if (!hasContract) {
    return <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-4 text-center text-sm">Choose a contract to see whether this is covered.</p>;
  }
  if (!preview) {
    return (
      <div className="grid gap-2 rounded-lg border px-4 py-4" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
    );
  }
  if (!preview.data) {
    return <p className="text-danger rounded-lg border px-4 py-3 text-sm">{preview.error ?? "Could not check the coverage."}</p>;
  }
  const c = preview.data;
  const [headline, ...rest] = c.reasons;
  const b = c.balance;
  const covered = c.coverage === "covered";

  return (
    <div
      className={`grid gap-3 rounded-lg border-2 px-4 py-4 transition-opacity ${covered ? "border-success/40" : "border-warning/40"} ${loading ? "opacity-60" : ""}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          variant="secondary"
          className={`border-0 px-2.5 py-1 text-sm font-semibold ${covered ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
        >
          {covered ? "COVERED BY AMC" : "CHARGEABLE"}
        </Badge>
        {c.serviceLabel ? <span className="text-muted-foreground text-xs">{c.serviceLabel}</span> : null}
      </div>
      {headline ? <p className="text-sm font-medium">{headline}</p> : null}
      {rest.length ? (
        <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-sm">
          {rest.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {c.chargeableExtras.length ? (
        <div className="bg-warning/5 rounded-md px-3 py-2 text-sm">
          <p className="text-warning text-xs font-medium">Chargeable extras</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {c.chargeableExtras.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Allowance</dt>
          <dd className="text-right font-medium">
            {!b
              ? "—"
              : b.unlimited
                ? `Unlimited · ${b.used} used · ${b.reserved} booked`
                : b.included === null
                  ? "Not counted"
                  : `${b.used} used · ${b.reserved} booked · ${b.remaining} of ${b.included} left`}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{priority === "emergency" ? "Attend by" : "Visit by"}</dt>
          <dd className="text-right font-medium">{slaDue ? shortDateTime(slaDue) : "—"}</dd>
        </div>
      </dl>
      {c.reserves ? <p className="text-muted-foreground text-xs">Logging it books one unit of the allowance until the work is done.</p> : null}
      {c.nearZero ? (
        <p className="text-warning flex items-center gap-1.5 text-xs font-medium">
          <AlertTriangle className="size-3.5" />
          The allowance is nearly used up{b?.remaining !== null && b?.remaining !== undefined ? ` (${b.remaining} left)` : ""}.
        </p>
      ) : null}
    </div>
  );
}
