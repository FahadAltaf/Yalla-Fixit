"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, GitBranch, History, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import {
  ActionDialogContent,
  ErrorState,
  ListSkeleton,
  SectionSkeleton,
  SubmitButton,
} from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_PLAN_LABELS,
  VERSION_REASONS,
  VERSION_REASON_LABELS,
  canRevise,
  type PaymentPlan,
  type VersionReason,
} from "@/lib/amc/proposal-rules";
import { proposalRulesService, type ProposalVersion } from "@/modules/amc-submissions";
import { formatCurrencyAED } from "@/utils/format-currency";

import { getAmcSettingsDefaults } from "./amc-settings";
import type { AmcSubmission } from "./amc-types";
import { AMC_STATUS_LABELS } from "./amc-types";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

/**
 * The proposal's versions (BRD 5.4, DEV-367): each locked version with its
 * reason, who and when, its price and the document the server printed;
 * the active version is the proposal itself. Prices side by side.
 */
export function ProposalVersionsPanel({ submission }: { submission: AmcSubmission }) {
  const [state, setState] = useState<{ key: string; versions: ProposalVersion[] | null; migrated: boolean; error: string | null }>({
    key: "",
    versions: null,
    migrated: true,
    error: null,
  });
  const key = `${submission.id}:${submission.current_version ?? 1}`;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let stale = false;
    proposalRulesService.versions(submission.id).then(
      (r) => !stale && setState({ key, versions: r.versions, migrated: r.migrated, error: null }),
      (e) => !stale && setState({ key, versions: null, migrated: true, error: e instanceof Error ? e.message : "Could not load the versions." }),
    );
    return () => {
      stale = true;
    };
  }, [submission.id, key, reload]);
  const [opening, setOpening] = useState<number | null>(null);

  const current = state.key === key ? state : { versions: null, migrated: true, error: null };
  const labels = new Map((submission.settings_snapshot?.services ?? getAmcSettingsDefaults().services).map((s) => [s.id, s.label]));
  const active = submission.current_version ?? 1;

  const open = async (versionNo: number) => {
    setOpening(versionNo);
    try {
      const { url } = await proposalRulesService.versionUrl(submission.id, versionNo);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the version.");
    } finally {
      setOpening(null);
    }
  };

  if (current.error) return <ErrorState title="Could not load the versions" message={current.error} onRetry={() => setReload((n) => n + 1)} />;
  if (!current.versions) {
    return (
      <SectionSkeleton>
        <ListSkeleton rows={3} />
      </SectionSkeleton>
    );
  }
  if (!current.migrated) {
    return (
      <SectionCard icon={<GitBranch />} title="Versions" bodyClassName="px-5 pb-5">
        <p className="text-muted-foreground text-sm">Versions arrive with the AMC database update 20261007140000.</p>
      </SectionCard>
    );
  }

  const versions = current.versions;
  /* Columns: every locked version, then the active one (the proposal itself). */
  const columns = [
    ...versions.map((v) => ({ key: `v${v.versionNo}`, label: `V${v.versionNo}`, lines: v.lines, finalPrice: v.finalPrice, discount: v.discountPercent, plan: v.paymentPlan })),
    {
      key: "active",
      label: `V${active} (active)`,
      lines: submission.services.map((s) => ({ serviceId: s.serviceId, included: s.included, units: s.units, frequency: s.frequency, basePrice: s.basePrice, price: s.price })),
      finalPrice: submission.final_price,
      discount: submission.discount_percent,
      plan: submission.payment_plan ?? null,
    },
  ];
  const serviceIds = [...new Set(columns.flatMap((c) => c.lines.filter((l) => l.included).map((l) => l.serviceId)))];

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        icon={<History />}
        title="Versions"
        description="A change after the client has seen the proposal makes a new version. Earlier versions are locked with the document the client was sent."
        bodyClassName="border-t"
      >
        <ul className="divide-y">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5 text-sm">
              <Badge variant="secondary" className="border-0 font-medium">V{v.versionNo}</Badge>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {v.reason ? VERSION_REASON_LABELS[v.reason] : "Original"}
                  {v.summary ? <span className="text-muted-foreground font-normal"> · {v.summary}</span> : null}
                </div>
                <div className="text-muted-foreground text-xs">
                  Started {when(v.startedAt)}
                  {v.startedBy ? ` by ${v.startedBy}` : ""} · locked {when(v.lockedAt)}
                  {v.lockedBy ? ` by ${v.lockedBy}` : ""} as {AMC_STATUS_LABELS[v.statusAtLock as keyof typeof AMC_STATUS_LABELS] ?? v.statusAtLock}
                </div>
              </div>
              <span className="tabular-nums">{formatCurrencyAED(v.finalPrice)}</span>
              <Button size="sm" variant="outline" disabled={opening === v.versionNo} onClick={() => void open(v.versionNo)}>
                {opening === v.versionNo ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                {v.contentType === "application/pdf" ? "PDF" : "Document"}
              </Button>
            </li>
          ))}
          <li className="flex flex-wrap items-start gap-3 px-5 py-3.5 text-sm">
            <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">V{active}</Badge>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {submission.version_reason ? VERSION_REASON_LABELS[submission.version_reason] : "Original"}
                {submission.version_summary ? <span className="text-muted-foreground font-normal"> · {submission.version_summary}</span> : null}
              </div>
              <div className="text-muted-foreground text-xs">Active version · {AMC_STATUS_LABELS[submission.status]}</div>
            </div>
            <span className="tabular-nums">{formatCurrencyAED(submission.final_price)}</span>
          </li>
        </ul>
      </SectionCard>

      {versions.length > 0 ? (
        <SectionCard icon={<GitBranch />} title="Prices side by side" description="Each service's annual price in every version, before VAT." bodyClassName="pb-2">
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Service</TableHead>
                  {columns.map((c) => (
                    <TableHead key={c.key} className="text-right last:pr-5">
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceIds.map((id) => (
                  <TableRow key={id}>
                    <TableCell className="pl-5 text-sm">{labels.get(id) ?? id}</TableCell>
                    {columns.map((c) => {
                      const line = c.lines.find((l) => l.serviceId === id && l.included);
                      return (
                        <TableCell key={c.key} className="text-right text-sm tabular-nums last:pr-5">
                          {line ? (
                            <>
                              {formatCurrencyAED(line.price)}
                              <div className="text-muted-foreground text-[11px]">
                                {line.units} × {line.frequency}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-5 text-sm">Discount</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="text-right text-sm tabular-nums last:pr-5">
                      {c.discount}%
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 text-sm font-medium">Final price</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="text-right text-sm font-medium tabular-nums last:pr-5">
                      {formatCurrencyAED(c.finalPrice)}
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 text-sm">Payment plan</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className="text-right text-sm last:pr-5">
                      {c.plan ? PAYMENT_PLAN_LABELS[c.plan as PaymentPlan] ?? c.plan : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </SectionCard>
      ) : (
        <Card className="p-0">
          <EmptyState
            className="border-0"
            icon={<GitBranch className="size-5" />}
            title="One version so far"
            description="If the client asks for changes after seeing the proposal, revise it: this version is locked with its document and V2 opens."
          />
        </Card>
      )}
    </div>
  );
}

/** Whether this viewer may revise the proposal: the owner, once the client has seen it. */
export function canReviseProposal(submission: AmcSubmission) {
  return canRevise(submission.status, submission.is_own !== false);
}

/**
 * Revise: lock the shared version and open the next as a draft (the
 * owner's action). Controlled, so the proposal page can open it from its
 * "More" menu -- a dialog inside a menu item closes with the menu.
 */
export function ReviseProposalDialog({
  submission,
  open,
  onOpenChange,
}: {
  submission: AmcSubmission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<VersionReason | "">("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const next = (submission.current_version ?? 1) + 1;

  const revise = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      const result = await proposalRulesService.revise({ id: submission.id, reason, summary: summary.trim() });
      toast.success(`V${result.lockedVersionNo} is locked with its document. V${result.versionNo} is open as a draft.`);
      router.push(`/extensions/amc/${submission.id}/edit?step=2`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revise the proposal.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revise this proposal</DialogTitle>
          <DialogDescription>
            V{next - 1} is locked with the document the client was sent, and V{next} opens as a draft that goes through approval again; the
            client&apos;s current link stops working.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="revise-reason">Why</Label>
            <Select value={reason} onValueChange={(value) => setReason(value as VersionReason)}>
              <SelectTrigger id="revise-reason" aria-label="Reason for the new version">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {VERSION_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {VERSION_REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="revise-summary">What changes</Label>
            <Textarea id="revise-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} placeholder="e.g. Client dropped plumbing; discount raised to 12%" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void revise()}
            disabled={!reason || summary.trim().length < 5}
            pending={busy}
            pendingLabel={`Locking V${next - 1}…`}
            icon={<GitBranch className="size-4" />}
          >
            Open V{next}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
