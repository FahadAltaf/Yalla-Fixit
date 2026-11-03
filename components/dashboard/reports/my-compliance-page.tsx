"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, MessageSquareWarning, UserX } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, StatGridSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { compliancePct, DisputeBadge } from "@/components/data-table/columns/column-compliance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dayName, eventLabel, monthName } from "@/lib/reports/compliance-disputes";
import { useViewerZone, viewerDateTime } from "@/lib/reports/viewer-time";
import type { MyCompliance, MyComplianceEvent } from "@/lib/server/reports/disputes";
import { reportsService } from "@/modules/reports/reports-service";

import { FlagBadge, plural } from "./shared";

/**
 * A technician's own compliance (BRD §6.7): the running figure all month,
 * the statement once it closes, each check-in owed, and a dispute for any
 * miss until the cut-off day. Reached from the N9 and N11 notifications and
 * the E2 email; the technician is the one linked to the signed-in account.
 */

type Linked = Extract<MyCompliance, { linked: true }>;

const aed = (value: number | null) => (value === null ? "—" : `AED ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const STATE_LABEL = { performed: "Recorded", missed: "Missed", waived: "Waived" } as const;

export function MyCompliancePage() {
  const router = useRouter();
  const params = useSearchParams();
  const month = params.get("month") ?? "";
  const [data, setData] = useState<MyCompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<MyComplianceEvent | null>(null);
  const zone = useViewerZone();

  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.myCompliance(month || undefined);
      if (mine === ticket.current) setData(response);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : "Could not load your compliance");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const linked = data && data.linked ? (data as Linked) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="My compliance"
        title={linked ? `${linked.technician.name}, ${monthName(linked.month)}` : "My app compliance"}
        description="Your check-ins and check-outs in the Zoho FSM app, for every shift and appointment."
        actions={
          linked ? (
            <Select value={linked.month} onValueChange={(next) => router.replace(`?month=${next}`)}>
              <SelectTrigger className="h-9 w-44" aria-label="Month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {linked.months.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {error ? <ErrorState title="Could not load your compliance" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {data && !data.linked ? (
        <Card className="py-0">
          <EmptyState
            icon={<UserX />}
            title="Your account is not linked to a technician"
            description="Compliance is shown to technicians whose portal account has the same email as in Zoho FSM. Ask an administrator to link it."
          />
        </Card>
      ) : null}

      {linked ? (
        <>
          <p className="text-muted-foreground text-xs">
            {statusLine(linked)} Times are in your timezone ({zone.label}).
          </p>
          <StatCardGrid columns={4}>
            <StatCard
              label="Compliance"
              value={compliancePct(linked.figures.compliancePercent)}
              headline={linked.figures.required ? `${linked.figures.performed} of ${plural(linked.figures.required, "check-in")} recorded` : "Nothing owed yet"}
              caption={linked.settings.thresholdPercent === null ? undefined : `Threshold ${linked.settings.thresholdPercent}%`}
              tone={linked.figures.belowThreshold ? "bad" : "neutral"}
            />
            <StatCard label="Missed" value={linked.figures.missed} headline={linked.figures.missed ? "Not recorded and not waived" : "None"} tone={linked.figures.missed ? "bad" : "neutral"} />
            <StatCard label="Waived" value={linked.figures.waived} headline={linked.figures.waived ? "Left out of both counts" : "None waived"} />
            <StatCard
              label="Penalty"
              value={linked.settings.thresholdPercent === null ? "—" : aed(linked.figures.belowThreshold ? linked.figures.penaltyPayableAed : 0)}
              headline={
                linked.figures.belowThreshold
                  ? `AED ${linked.settings.penaltyPerMissAed} a miss, capped at AED ${linked.settings.monthlyCapAed}`
                  : `None at or above ${linked.settings.thresholdPercent ?? "—"}%`
              }
              caption="Decided by HR; not deducted by the portal"
            />
          </StatCardGrid>

          <Card className="gap-0 py-0">
            {linked.events.length === 0 ? (
              <EmptyState icon={<BadgeCheck />} title="Nothing owed yet" description="Check-ins appear here as your shifts and appointments come due." />
            ) : (
              <ul className="divide-y">
                {linked.events.map((e) => (
                  <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {e.kindLabel}
                        {e.appointmentNumber ? ` · ${e.appointmentNumber}` : ""}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Due {e.dueAt ? viewerDateTime(e.dueAt) : dayName(e.date)}
                        {e.recordedAt ? ` · recorded ${viewerDateTime(e.recordedAt)}` : ""}
                        {e.waiverReason ? ` · waived: ${e.waiverReason}` : ""}
                      </p>
                      {e.dispute ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Your dispute: {e.dispute.reason}
                          {e.dispute.note ? ` · reviewer: ${e.dispute.note}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <FlagBadge tone={e.state === "missed" ? "danger" : "muted"}>{STATE_LABEL[e.state]}</FlagBadge>
                      {e.dispute ? <DisputeBadge status={e.dispute.status} /> : null}
                      {e.state === "missed" && !e.cannotDispute ? (
                        <Button size="sm" variant="outline" onClick={() => setDisputing(e)}>
                          <MessageSquareWarning className="size-4" />
                          Dispute
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : !error && loading ? (
        <StatGridSkeleton count={4} columns={4} />
      ) : null}

      {disputing && linked ? (
        <DisputeDialog
          event={disputing}
          cutoffDate={linked.cutoffDate}
          onClose={() => setDisputing(null)}
          onSubmit={async (reason) => {
            await reportsService.raiseDispute({ month: linked.month, eventKey: disputing.key, reason });
            toast.success("Dispute raised; a reviewer will decide it");
            setDisputing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function statusLine(d: Linked) {
  if (d.finalized) return `${monthName(d.month)} is final: these are the figures sent to HR.`;
  if (d.phase === "running") {
    return `Running to today${d.settledPercent === null ? "" : `; ${compliancePct(d.settledPercent)} up to yesterday`}. Disputes are open until ${dayName(d.cutoffDate)}.`;
  }
  if (d.phase === "disputes_open") return `Your statement for ${monthName(d.month)}. Dispute a missed check-in by ${dayName(d.cutoffDate)}; after that no change is possible.`;
  return `Disputes closed on ${dayName(d.cutoffDate)}.`;
}

function DisputeDialog({
  event,
  cutoffDate,
  onClose,
  onSubmit,
}: {
  event: MyComplianceEvent;
  cutoffDate: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The dispute was not raised");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Dispute a missed check-in</DialogTitle>
          <DialogDescription>
            The {eventLabel(event)} on {dayName(event.date)}. A reviewer decides it; accepted, the miss is waived. Disputes close on {dayName(cutoffDate)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="my-dispute-reason">What happened</Label>
          <Textarea id="my-dispute-reason" rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={reason.trim().length < 3} onClick={() => void submit()}>
            Raise dispute
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
