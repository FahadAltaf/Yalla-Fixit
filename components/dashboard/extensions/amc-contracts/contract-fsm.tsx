"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, CheckCircle2, Link2, PlugZap, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { formatQuantity } from "@/lib/amc/contracts";
import {
  amcContractsService,
  type ContractDetail,
  type ContractFsmActivity,
  type FsmWorkOrderForAmc,
} from "@/modules/amc-contracts/amc-contracts-service";

import { formatContractDate, formatDateTime } from "./contract-status";

type Entitlement = ContractDetail["entitlements"][number];
type Visit = ContractFsmActivity["visits"][number];

const SYNC_LABELS: Record<string, string> = {
  recorded: "Usage recorded",
  skipped: "No usage",
  needs_review: "Needs review",
  failed: "Check failed",
  pending: "Pending",
};

const SLA_LABELS: Record<string, string> = {
  met: "Met",
  breached: "Breached",
  pending: "Pending",
  unknown: "Unknown",
};

function usageSourceLabel(source: string): string {
  return source === "fsm" ? "FSM" : source === "manual" ? "Manual" : source;
}

/**
 * Zoho FSM on the contract: how far the contract is connected (customer,
 * service mappings, linked work, automation), the work linked to it,
 * upcoming visits and the visit history. Operational diagnostics, not
 * customer-facing.
 */
export function ContractFsm({
  contractId,
  entitlements,
  canManage,
  onUsageChanged,
}: {
  contractId: string;
  entitlements: Entitlement[];
  canManage: boolean;
  onUsageChanged: () => void;
}) {
  const [data, setData] = useState<ContractFsmActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [linkCustomer, setLinkCustomer] = useState(false);
  const [linkWork, setLinkWork] = useState(false);
  /* Kept after the dialog closes, so it can animate out with its content. */
  const [reviewing, setReviewing] = useState<Visit | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData((await amcContractsService.fsm(contractId)).fsm);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the FSM activity.");
    }
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkFsm = async () => {
    setChecking(true);
    try {
      const result = await amcContractsService.checkFsm(contractId);
      const review = result.outcomes.filter((o) => o.status === "needs_review").length;
      const failed = result.outcomes.filter((o) => o.status === "failed").length;
      toast.success(
        `Checked ${result.checked} appointment${result.checked === 1 ? "" : "s"} in FSM` +
          (review ? `; ${review} to review` : "") +
          (failed ? `; ${failed} could not be read` : ""),
      );
      await load();
      onUsageChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check FSM.");
    } finally {
      setChecking(false);
    }
  };

  if (error) {
    return (
      <SectionCard title="Zoho FSM" icon={<PlugZap />} bodyClassName="px-5 pb-5">
        <ErrorState title="Could not load the FSM activity" message={error} onRetry={() => void load()} />
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard title="Zoho FSM" icon={<PlugZap />} bodyClassName="px-5 pb-5">
        <ListSkeleton rows={3} />
      </SectionCard>
    );
  }

  const s = data.status;
  const auto = s.automation;

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Zoho FSM integration"
        description="How far this contract is connected to FSM. For the operations team."
        icon={<PlugZap />}
        bodyClassName="px-5 pb-5"
        action={
          canManage && data.migrated ? (
            <div className="flex flex-wrap gap-2">
              <SubmitButton
                size="sm"
                variant="outline"
                onClick={() => void checkFsm()}
                disabled={s.linkedWork === 0}
                pending={checking}
                pendingLabel="Checking…"
                icon={<RefreshCw className="size-4" />}
              >
                Check FSM
              </SubmitButton>
              <Button size="sm" onClick={() => setLinkWork(true)}>
                <Link2 className="size-4" />
                Link FSM work
              </Button>
            </div>
          ) : null
        }
      >
        {!data.migrated ? (
          <p className="text-muted-foreground text-sm">
            Needs migration 20261006120000 (AMC FSM integration) before work can be linked.
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <StatusItem
              label="FSM client"
              value={s.customer === "linked" ? "Linked" : "Missing"}
              tone={s.customer === "linked" ? "good" : "warn"}
              hint={
                s.fsmCustomer?.fsmContactId
                  ? `${s.fsmCustomer.fsmContactName ?? "Contact"}${s.fsmCustomer.fsmCustomerId ? ` · ${s.fsmCustomer.fsmCustomerId}` : ""}`
                  : "Usage cannot be matched to the client automatically"
              }
              action={
                canManage ? (
                  <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setLinkCustomer(true)}>
                    {s.customer === "linked" ? "Change" : "Link"}
                  </Button>
                ) : null
              }
            />
            <StatusItem
              label="Service mappings"
              value={`${s.mappings.mapped}/${s.mappings.total} mapped`}
              tone={s.mappings.total > 0 && s.mappings.mapped === s.mappings.total ? "good" : "warn"}
              hint={s.mappings.unmapped.length ? `Unmapped: ${s.mappings.unmapped.join(", ")}` : "Every counted service is mapped"}
              action={
                <Button asChild size="sm" variant="link" className="h-auto p-0">
                  <Link href="/extensions/amc-contracts/fsm-services">Mapping</Link>
                </Button>
              }
            />
            <StatusItem
              label="Linked work"
              value={`${s.linkedWork} linked`}
              hint={`${s.linkedAppointments} by appointment, ${s.linkedWork - s.linkedAppointments} by whole work order`}
            />
            <StatusItem
              label="Automatic usage"
              value={auto.any ? "Enabled" : "Disabled"}
              tone={auto.any ? "good" : "muted"}
              hint={`Visits ${auto.visits ? "on" : "off"} · Hours ${auto.hours ? "on" : "off"} · Unlimited ${auto.unlimited ? "on" : "off"}. Completed visits wait for review.`}
            />
            <StatusItem
              label="Completion signal"
              value={s.completionStatuses.join(", ")}
              tone="muted"
              hint="Status with an actual end time. Not yet confirmed as 'service delivered'."
            />
            <StatusItem
              label="SLA tracking"
              value={s.slaTracking === "not_applicable" ? "Not applicable" : "Unavailable"}
              tone="muted"
              hint={
                s.slaTracking === "not_applicable"
                  ? "No call-out services on this contract"
                  : "Request time is entered on links; FSM has no confirmed attendance or booking time"
              }
            />
          </dl>
        )}
      </SectionCard>

      {data.migrated ? (
        <>
          <SectionCard
            title="Upcoming visits"
            description="Appointments of linked FSM work on the scheduling board, still to happen."
            icon={<CalendarClock />}
            bodyClassName="px-5 pb-5"
          >
            {data.upcoming.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {s.linkedWork === 0
                  ? "No FSM work is linked yet. Upcoming visits appear once work is linked and placed on the board."
                  : "No upcoming appointments of the linked work are on the scheduling board."}
              </p>
            ) : (
              <VisitTable visits={data.upcoming} upcoming />
            )}
          </SectionCard>

          <SectionCard
            title="Visit history"
            description="Linked FSM appointments and usage recorded by hand. Usage from FSM is recorded only when confirmed."
            icon={<CheckCircle2 />}
            bodyClassName="px-5 pb-5"
          >
            {data.visits.length === 0 ? (
              <p className="text-muted-foreground text-sm">No visits yet.</p>
            ) : (
              <VisitTable
                visits={data.visits}
                canManage={canManage}
                onReview={(visit) => {
                  setReviewing(visit);
                  setReviewOpen(true);
                }}
              />
            )}
          </SectionCard>

          {data.links.length ? (
            <SectionCard title="Linked FSM work" icon={<Link2 />} bodyClassName="px-5 pb-5">
              <ul className="divide-y text-sm">
                {data.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {l.fsmWorkOrderName ?? l.fsmWorkOrderId}
                        {l.fsmAppointmentName ? ` · ${l.fsmAppointmentName}` : " · all appointments"}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {l.serviceLabel} · {String(l.coverage.headline ?? "")} · linked {formatDateTime(l.linkedAt)}
                        {l.linkedBy ? ` by ${l.linkedBy}` : ""}
                        {l.requestedAt ? ` · requested ${formatDateTime(l.requestedAt)}` : ""}
                      </div>
                    </div>
                    {canManage ? (
                      <Button size="sm" variant="ghost" onClick={() => setUnlinking(l.id)}>
                        <Unlink className="size-4" />
                        Unlink
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </>
      ) : null}

      <LinkCustomerDialog
        open={linkCustomer}
        onOpenChange={setLinkCustomer}
        contractId={contractId}
        onLinked={() => void load()}
      />
      <LinkWorkDialog
        open={linkWork}
        onOpenChange={setLinkWork}
        contractId={contractId}
        entitlements={entitlements}
        onLinked={() => void load()}
      />
      {reviewing ? (
        <ReviewVisitDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          contractId={contractId}
          visit={reviewing}
          entitlement={entitlements.find((e) => e.id === reviewing.entitlementId)}
          onDone={() => {
            setReviewOpen(false);
            void load();
            onUsageChanged();
          }}
        />
      ) : null}
      <UnlinkDialog
        open={Boolean(unlinking)}
        onOpenChange={(next) => !next && setUnlinking(null)}
        contractId={contractId}
        linkId={unlinking}
        onDone={() => {
          setUnlinking(null);
          void load();
        }}
      />
    </div>
  );
}

function StatusItem({
  label,
  value,
  hint,
  tone = "neutral",
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "muted" | "neutral";
  action?: React.ReactNode;
}) {
  const toneClass =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted-foreground"
          : "";
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        {label}
        {action}
      </dt>
      <dd className={`font-medium ${toneClass}`}>{value}</dd>
      {hint ? <dd className="text-muted-foreground text-xs">{hint}</dd> : null}
    </div>
  );
}

function VisitTable({
  visits,
  upcoming,
  canManage,
  onReview,
}: {
  visits: Visit[];
  upcoming?: boolean;
  canManage?: boolean;
  onReview?: (visit: Visit) => void;
}) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Date</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Work order</TableHead>
            <TableHead>Appointment</TableHead>
            <TableHead>Technician</TableHead>
            <TableHead>FSM status</TableHead>
            {upcoming ? null : <TableHead>Usage</TableHead>}
            <TableHead>Coverage</TableHead>
            {upcoming ? null : <TableHead>SLA</TableHead>}
            {upcoming ? null : (
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visits.map((v) => (
            <TableRow key={v.key}>
              <TableCell className="pl-5 align-top tabular-nums">
                {v.date ? (upcoming ? formatDateTime(v.date) : formatContractDate(v.date.slice(0, 10))) : "—"}
              </TableCell>
              <TableCell className="align-top font-medium">{v.serviceLabel}</TableCell>
              <TableCell className="align-top">{v.workOrder ?? "—"}</TableCell>
              <TableCell className="align-top">
                {v.manual ? <span className="text-muted-foreground">Recorded by hand</span> : v.appointment ?? v.appointmentId ?? "—"}
              </TableCell>
              <TableCell className="align-top">{v.technicians.length ? v.technicians.join(", ") : "—"}</TableCell>
              <TableCell className="align-top">
                {v.fsmStatus ? (
                  <div>
                    {v.fsmStatus}
                    {v.checkedAt ? <div className="text-muted-foreground text-xs">as of {formatDateTime(v.checkedAt)}</div> : null}
                  </div>
                ) : (
                  "—"
                )}
              </TableCell>
              {upcoming ? null : (
                <TableCell className="align-top">
                  {v.usage ? (
                    <div>
                      {formatQuantity(v.usage.quantity)}{" "}
                      <Badge variant="secondary" className="bg-mist text-ink-soft ml-1 border-0 font-medium">
                        {usageSourceLabel(v.usage.source)}
                      </Badge>
                    </div>
                  ) : v.syncStatus ? (
                    <span className={v.syncStatus === "needs_review" ? "text-warning" : "text-muted-foreground"}>
                      {SYNC_LABELS[v.syncStatus] ?? v.syncStatus}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not checked</span>
                  )}
                </TableCell>
              )}
              <TableCell className="align-top">{v.coverage ?? (v.manual ? "—" : "Not recorded")}</TableCell>
              {upcoming ? null : (
                <TableCell className="align-top">
                  {v.sla ? (
                    <div title={v.sla.missing ?? undefined}>
                      <div>{v.sla.label}</div>
                      <div className="text-muted-foreground text-xs">
                        {v.sla.actualMinutes !== null ? `Actual ${v.sla.actualMinutes} min · ` : "Actual: unavailable · "}
                        {SLA_LABELS[v.sla.state] ?? v.sla.state}
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}
              {upcoming ? null : (
                <TableCell className="pr-5 text-right align-top">
                  {canManage && !v.manual && v.appointmentId && v.syncStatus === "needs_review" ? (
                    <Button size="sm" variant="outline" onClick={() => onReview?.(v)}>
                      Review
                    </Button>
                  ) : null}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

/* From a contract: the server allows the lookup to whoever may operate it. */
function useWorkOrderLookup(contractId: string) {
  const [ref, setRef] = useState("");
  const [workOrder, setWorkOrder] = useState<FsmWorkOrderForAmc | null>(null);
  const [looking, setLooking] = useState(false);
  const lookup = async () => {
    setLooking(true);
    setWorkOrder(null);
    try {
      setWorkOrder((await amcContractsService.fsmWorkOrder(ref.trim(), contractId)).workOrder);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not find the work order.");
    } finally {
      setLooking(false);
    }
  };
  const reset = () => {
    setRef("");
    setWorkOrder(null);
  };
  return { ref, setRef, workOrder, looking, lookup, reset };
}

function WorkOrderField({ lookup, id }: { lookup: ReturnType<typeof useWorkOrderLookup>; id: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>FSM work order number</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          placeholder="e.g. WO731"
          value={lookup.ref}
          maxLength={40}
          onChange={(event) => lookup.setRef(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && lookup.ref.trim().length >= 2 && void lookup.lookup()}
        />
        <SubmitButton
          variant="outline"
          onClick={() => void lookup.lookup()}
          disabled={lookup.ref.trim().length < 2}
          pending={lookup.looking}
          pendingLabel="Finding…"
        >
          Find
        </SubmitButton>
      </div>
    </div>
  );
}

function LinkCustomerDialog({
  open,
  onOpenChange,
  contractId,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  onLinked: () => void;
}) {
  const lookup = useWorkOrderLookup(contractId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string | null; customerId: string | null; matches: boolean | null } | null>(null);

  useEffect(() => {
    if (open) {
      lookup.reset();
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const link = async () => {
    if (!lookup.workOrder) return;
    setBusy(true);
    try {
      const { customer } = await amcContractsService.linkFsmCustomer(contractId, lookup.workOrder.workOrderId);
      setResult({ name: customer.fsmContactName, customerId: customer.fsmCustomerId, matches: customer.matchesProposalCustomerId });
      toast.success("FSM client linked");
      onLinked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link the client.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link the FSM client</DialogTitle>
          <DialogDescription>
            Find a work order of this client in FSM. Its FSM contact becomes the contract&apos;s FSM
            client, by id. Clients are never matched by name.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-2 py-2 text-sm">
            <p>
              Linked to <span className="font-medium">{result.name ?? "the FSM contact"}</span>
              {result.customerId ? ` (Client ID ${result.customerId})` : " (no Client ID in FSM)"}.
            </p>
            {result.matches === false ? (
              <p className="text-warning">
                The proposal&apos;s Client ID differs from FSM&apos;s. Check that this is the right client.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <WorkOrderField lookup={lookup} id="amc-fsm-customer-wo" />
            {lookup.workOrder ? (
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{lookup.workOrder.workOrderName}</div>
                <div className="text-muted-foreground text-xs">
                  FSM contact: {lookup.workOrder.contactName ?? "none"}
                  {lookup.workOrder.contactId ? "" : " (cannot link)"}
                </div>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <SubmitButton
                onClick={() => void link()}
                disabled={!lookup.workOrder?.contactId}
                pending={busy}
                pendingLabel="Linking…"
                icon={<Link2 className="size-4" />}
              >
                Link this client
              </SubmitButton>
            </>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

const ALL = "__all__";
const NONE = "__none__";

function LinkWorkDialog({
  open,
  onOpenChange,
  contractId,
  entitlements,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  entitlements: Entitlement[];
  onLinked: () => void;
}) {
  const lookup = useWorkOrderLookup(contractId);
  const linkable = entitlements.filter((e) => e.entitlementType !== "informational");
  const [appointmentId, setAppointmentId] = useState(ALL);
  const [lineId, setLineId] = useState(NONE);
  const [entitlementId, setEntitlementId] = useState("");
  const [requestedAt, setRequestedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ headline: string; details: string[] } | null>(null);

  useEffect(() => {
    if (open) {
      lookup.reset();
      setAppointmentId(ALL);
      setLineId(NONE);
      setEntitlementId("");
      setRequestedAt("");
      setVerdict(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  /* A line mapped to one of this contract's services picks that service. */
  const chooseLine = (value: string) => {
    setLineId(value);
    const line = lookup.workOrder?.lines.find((l) => l.id === value);
    const match = line?.amcServiceId ? linkable.find((e) => e.serviceId === line.amcServiceId) : undefined;
    if (match?.id) setEntitlementId(match.id);
  };

  const wo = lookup.workOrder;
  const liveAppointments = (wo?.appointments ?? []).filter((a) => a.state !== "cancelled");

  const link = async () => {
    if (!wo || !entitlementId) return;
    setBusy(true);
    try {
      const result = await amcContractsService.linkFsmWork(contractId, {
        workOrderId: wo.workOrderId,
        appointmentId: appointmentId === ALL ? null : appointmentId,
        serviceLineItemId: lineId === NONE ? null : lineId,
        entitlementId,
        requestedAt: requestedAt ? `${requestedAt}:00+04:00` : null,
      });
      setVerdict(result.verdict);
      toast.success("FSM work linked");
      onLinked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link the work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link FSM work</DialogTitle>
          <DialogDescription>
            Tie a work order (or one of its appointments) to a service on this contract. The coverage
            answer is recorded. Nothing is consumed by linking.
          </DialogDescription>
        </DialogHeader>
        {verdict ? (
          <div className="my-2 grid gap-2 rounded-lg border p-3 text-sm">
            <div className="font-medium">{verdict.headline}</div>
            <ul className="text-muted-foreground list-disc pl-5">
              {verdict.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <WorkOrderField lookup={lookup} id="amc-fsm-link-wo" />
            {wo ? (
              <>
                <p className="text-muted-foreground text-xs">
                  {wo.workOrderName} · FSM contact {wo.contactName ?? "none"}
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="amc-fsm-link-appt">Appointment</Label>
                  <Select value={appointmentId} onValueChange={setAppointmentId}>
                    <SelectTrigger id="amc-fsm-link-appt">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All appointments of this work order</SelectItem>
                      {liveAppointments.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} · {a.status ?? "no status"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="amc-fsm-link-line">Service line (optional)</Label>
                  <Select value={lineId} onValueChange={chooseLine}>
                    <SelectTrigger id="amc-fsm-link-line">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not specified</SelectItem>
                      {wo.lines.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name} · {l.serviceName ?? "no service"}
                          {l.amcServiceId ? ` → ${l.amcServiceId}` : " (unmapped)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="amc-fsm-link-ent">AMC service</Label>
                  <Select value={entitlementId} onValueChange={setEntitlementId}>
                    <SelectTrigger id="amc-fsm-link-ent">
                      <SelectValue placeholder="Choose the contract service" />
                    </SelectTrigger>
                    <SelectContent>
                      {linkable.map((e) => (
                        <SelectItem key={e.id} value={e.id!}>
                          {e.serviceLabel} · {e.usageLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="amc-fsm-link-req">Client request time (optional)</Label>
                  <Input
                    id="amc-fsm-link-req"
                    type="datetime-local"
                    value={requestedAt}
                    onChange={(event) => setRequestedAt(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Dubai time. FSM does not record when the client asked; response targets are measured from this.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        )}
        <DialogFooter>
          {verdict ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <SubmitButton
                onClick={() => void link()}
                disabled={!wo || !entitlementId}
                pending={busy}
                pendingLabel="Linking…"
                icon={<Link2 className="size-4" />}
              >
                Link work
              </SubmitButton>
            </>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function ReviewVisitDialog({
  open,
  onOpenChange,
  contractId,
  visit,
  entitlement,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  visit: Visit;
  entitlement: Entitlement | undefined;
  onDone: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ reason: string; code: string; suggested: number | null } | null>(null);
  /* Hours are entered by a person: FSM has no approved hours. */
  const hours = plan?.code === "hours_unavailable" && entitlement?.entitlementType === "hours";

  /* Re-read FSM first, so the person confirms what FSM says now. */
  useEffect(() => {
    if (!open || !visit.appointmentId) return;
    let stale = false;
    setPlan(null);
    setError(null);
    setQuantity("");
    amcContractsService.syncFsmAppointment(contractId, visit.appointmentId).then(
      ({ outcome }) => {
        if (stale) return;
        setPlan({ reason: outcome.reason, code: outcome.code, suggested: outcome.suggestedQuantity });
        if (outcome.status !== "needs_review") setError(`Nothing to confirm: ${outcome.reason}`);
      },
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not read the appointment."),
    );
    return () => {
      stale = true;
    };
  }, [open, contractId, visit.appointmentId]);

  const confirm = async () => {
    if (!visit.appointmentId) return;
    setBusy(true);
    try {
      const { outcome } = await amcContractsService.syncFsmAppointment(contractId, visit.appointmentId, {
        confirm: true,
        quantity: hours ? Number(quantity) : null,
      });
      if (outcome.status === "recorded" || outcome.status === "reversed") {
        toast.success(outcome.status === "recorded" ? "Usage recorded from FSM" : "Usage taken back");
        onDone();
      } else {
        toast.error(outcome.reason);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the usage.");
    } finally {
      setBusy(false);
    }
  };

  const hoursOk = !hours || (Number(quantity) > 0 && Number.isFinite(Number(quantity)));

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review FSM visit</DialogTitle>
          <DialogDescription>
            {visit.serviceLabel} · {visit.appointment ?? visit.appointmentId} · {visit.workOrder}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 text-sm">
          {plan ? <p>{plan.reason}</p> : !error ? <ListSkeleton rows={2} /> : null}
          {hours && plan ? (
            <div className="grid gap-2">
              <Label htmlFor="amc-fsm-hours">Hours to record</Label>
              <Input
                id="amc-fsm-hours"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.25"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              {plan.suggested !== null ? (
                <p className="text-muted-foreground text-xs">
                  FSM&apos;s actual duration was {formatQuantity(plan.suggested)} h (elapsed appointment time, not
                  approved hours).
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p className="text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void confirm()}
            disabled={!plan || Boolean(error) || !hoursOk}
            pending={busy}
            pendingLabel="Recording…"
            icon={<Check className="size-4" />}
          >
            Confirm
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function UnlinkDialog({
  open,
  onOpenChange,
  contractId,
  linkId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  linkId: string | null;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const submit = async () => {
    if (!linkId) return;
    setBusy(true);
    try {
      await amcContractsService.unlinkFsmWork(contractId, linkId, reason.trim());
      toast.success("FSM work unlinked");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unlink.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unlink FSM work?</DialogTitle>
          <DialogDescription>
            The link is kept in the history. Usage already recorded is not changed; correct it from the
            usage history if it should not count.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="amc-fsm-unlink">Reason</Label>
          <Textarea id="amc-fsm-unlink" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep link
          </Button>
          <SubmitButton
            variant="destructive"
            onClick={() => void submit()}
            disabled={reason.trim().length < 3}
            pending={busy}
            pendingLabel="Unlinking…"
            icon={<Unlink className="size-4" />}
          >
            Unlink
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
