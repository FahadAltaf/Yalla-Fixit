"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Check, Database, FilePen, Plus, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import DateSelect from "@/components/ui/date-select";
import {
  AMENDMENT_HINTS,
  AMENDMENT_KINDS,
  AMENDMENT_LABELS,
  AMENDMENT_STATUS_LABELS,
  amendmentProblem,
  amendmentRequestSchema,
  terminationEffective,
  type AmendmentKind,
  type AmendmentStatus,
} from "@/lib/amc/amendments";
import { cn } from "@/lib/utils";
import { amcContractsService, type CustomerRecord, type PropertyRecord } from "@/modules/amc-contracts/amc-contracts-service";
import {
  proposalEditHref,
  renewalsService,
  type AmendmentRecord,
  type AmendmentRequestBody,
} from "@/modules/amc-contracts/renewals-service";

import { Fact, Field, useActionForm } from "./call-out-shared";
import { formatContractDate, formatDateTime } from "./contract-status";
import { CustomerSearch, PropertySelect } from "./customer-pickers";
import { useDialog } from "./profile/use-dialog";
import { Tint } from "./renewal-shared";
import { useAmcData } from "./use-amc-data";

/**
 * A contract's amendments (Phase 13: DEV-417): scope change, property
 * change, hold, resume, transfer, early termination and cancellation.
 * Each is asked for with a reason, decided by an AMC approver who is not
 * the requester, then applied, which is when the contract changes. The
 * server checks every step; the flags here only decide what is offered.
 */

const STATUS_TONE: Record<AmendmentStatus, string> = {
  requested: "bg-warning/10 text-warning",
  approved: "bg-brand-50 text-brand",
  rejected: "bg-danger/10 text-danger",
  applied: "bg-success/10 text-success",
  withdrawn: "bg-mist text-ink-soft",
};

const SCOPE_MODE_LABELS: Record<string, string> = {
  add_services: "A new contract for the extra services",
  replace_contract: "This contract ended and a full new one written",
};

const today = () => format(new Date(), "yyyy-MM-dd");
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function AmendmentStatusBadge({ status }: { status: AmendmentStatus }) {
  return <Tint tone={STATUS_TONE[status] ?? "bg-mist text-ink-soft"}>{AMENDMENT_STATUS_LABELS[status] ?? status}</Tint>;
}

export function ContractAmendmentsPanel({
  contractId,
  contractStatus,
  contractNumber,
  propertyLabel,
  onChanged,
}: {
  contractId: string;
  contractStatus: string;
  contractNumber: string;
  propertyLabel: string;
  /** The contract itself may have moved (status, property, client). */
  onChanged: () => void;
}) {
  const router = useRouter();
  const { data, error, loading, reload } = useAmcData(() => renewalsService.amendments(contractId), `amendments:${contractId}`);
  const requesting = useDialog<true>();
  const approving = useDialog<AmendmentRecord>();
  const { ask, dialog: actionDialog } = useActionForm();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const amendments = data?.amendments ?? [];
  const canRequest = Boolean(data?.canRequest && data.migrated);

  const afterChange = () => {
    reload();
    onChanged();
  };

  const reject = (a: AmendmentRecord) =>
    ask({
      title: `Reject the ${AMENDMENT_LABELS[a.kind].toLowerCase()}`,
      description: "The requester is told, with your reason. The contract does not change.",
      fields: [{ key: "comment", label: "Why it is rejected", type: "textarea", minLength: 3 }],
      confirmText: "Reject",
      pendingLabel: "Rejecting…",
      variant: "destructive",
      icon: <X className="size-4" />,
      submit: async ({ comment }) => {
        await renewalsService.amendmentAction(contractId, a.id, { action: "reject", comment });
        toast.success("Amendment rejected");
        reload();
      },
    });

  const withdraw = async (a: AmendmentRecord) => {
    const done = await confirm({
      title: `Withdraw the ${AMENDMENT_LABELS[a.kind].toLowerCase()}?`,
      description: "The request is closed and nothing changes on the contract. A new one can be asked for later.",
      confirmText: "Withdraw",
      action: () => renewalsService.amendmentAction(contractId, a.id, { action: "withdraw" }),
    });
    if (done) {
      toast.success("Amendment withdrawn");
      reload();
    }
  };

  const apply = async (a: AmendmentRecord) => {
    const result: { submissionId?: string } = {};
    const destructive = a.kind === "early_termination" || a.kind === "cancellation";
    const done = await confirm({
      title: `Apply the ${AMENDMENT_LABELS[a.kind].toLowerCase()}?`,
      description: applyDescription(a, propertyLabel),
      confirmText: "Apply",
      variant: destructive ? "destructive" : "default",
      action: async () => {
        const r = await renewalsService.amendmentAction(contractId, a.id, { action: "apply" });
        result.submissionId = r.submissionId;
      },
    });
    if (!done) return;
    if (result.submissionId) {
      const id = result.submissionId;
      toast.success("Applied. The new proposal is a draft in AMC proposals.", {
        action: { label: "Open proposal", onClick: () => router.push(proposalEditHref(id)) },
      });
    } else {
      toast.success("Amendment applied");
    }
    afterChange();
  };

  return (
    <SectionCard
      title="Amendments"
      icon={<FilePen />}
      description="Edge cases that need approval: each is asked for with a reason, approved by someone else, then applied."
      bodyClassName="px-5 pb-5 space-y-4"
      action={
        canRequest ? (
          <Button size="sm" onClick={() => requesting.show(true)}>
            <Plus className="size-4" />
            Request an amendment
          </Button>
        ) : null
      }
    >
      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Amendments are not set up on this database yet</AlertTitle>
          <AlertDescription>They need migration 20261012140000. Ask an admin to apply it.</AlertDescription>
        </Alert>
      ) : error ? (
        <ErrorState title="Could not load the amendments" message={error} onRetry={reload} />
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : amendments.length === 0 ? (
        <EmptyState
          icon={<FilePen />}
          title="No amendments"
          description="A scope or property change, a hold or resume, a transfer, an early termination or a cancellation is asked for here and approved before the contract changes."
          action={canRequest ? { label: "Request an amendment", onClick: () => requesting.show(true) } : undefined}
        />
      ) : (
        <ul className="grid gap-3">
          {amendments.map((a) => (
            <AmendmentItem
              key={a.id}
              amendment={a}
              propertyLabel={propertyLabel}
              userId={data?.userId ?? ""}
              canApprove={Boolean(data?.canApprove)}
              canOperate={Boolean(data?.canRequest)}
              onApprove={() => approving.show(a)}
              onReject={() => reject(a)}
              onApply={() => void apply(a)}
              onWithdraw={() => void withdraw(a)}
            />
          ))}
        </ul>
      )}

      <RequestAmendmentDialog
        key={`request-${requesting.key}`}
        open={requesting.open}
        onOpenChange={requesting.onOpenChange}
        contractId={contractId}
        contractStatus={contractStatus}
        contractNumber={contractNumber}
        onRequested={reload}
      />
      <ApproveAmendmentDialog
        key={`approve-${approving.key}`}
        open={approving.open}
        onOpenChange={approving.onOpenChange}
        contractId={contractId}
        amendment={approving.target}
        onApproved={reload}
      />
      {actionDialog}
      {confirmDialog}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* One amendment                                                       */
/* ------------------------------------------------------------------ */

function AmendmentItem({
  amendment: a,
  propertyLabel,
  userId,
  canApprove,
  canOperate,
  onApprove,
  onReject,
  onApply,
  onWithdraw,
}: {
  amendment: AmendmentRecord;
  propertyLabel: string;
  userId: string;
  canApprove: boolean;
  canOperate: boolean;
  onApprove: () => void;
  onReject: () => void;
  onApply: () => void;
  onWithdraw: () => void;
}) {
  const own = Boolean(a.requestedBy) && a.requestedBy === userId;
  const canDecide = a.status === "requested" && canApprove && !own;
  const canApply = a.status === "approved" && (canOperate || canApprove);
  const canWithdraw = (a.status === "requested" || a.status === "approved") && (own || canApprove);

  return (
    <li className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{AMENDMENT_LABELS[a.kind] ?? a.kind}</span>
            <AmendmentStatusBadge status={a.status} />
          </div>
          {a.effectiveOn ? (
            <span className="text-muted-foreground text-xs">
              {a.kind === "early_termination" ? "Takes effect" : "Effective"} {formatContractDate(a.effectiveOn)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canDecide ? (
            <>
              <Button size="sm" variant="outline" onClick={onReject}>
                <X className="size-4" />
                Reject
              </Button>
              <Button size="sm" onClick={onApprove}>
                <Check className="size-4" />
                Approve
              </Button>
            </>
          ) : null}
          {canApply ? (
            <Button size="sm" onClick={onApply}>
              <Wand2 className="size-4" />
              Apply
            </Button>
          ) : null}
          {canWithdraw ? (
            <Button size="sm" variant="ghost" onClick={onWithdraw}>
              <Undo2 className="size-4" />
              Withdraw
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-sm whitespace-pre-wrap">{a.reason}</p>

      <AmendmentDetails amendment={a} propertyLabel={propertyLabel} />

      {a.status === "requested" && own ? (
        <p className="text-muted-foreground text-xs">Someone else must approve your request.</p>
      ) : null}

      <div className="text-muted-foreground grid gap-0.5 border-t pt-2 text-xs">
        <span>
          Requested by {a.requestedByName ?? "—"} · {formatDateTime(a.requestedAt)}
        </span>
        {a.decidedAt ? (
          <span>
            {a.status === "rejected" ? "Rejected" : "Approved"} by {a.decidedByName ?? "—"} · {formatDateTime(a.decidedAt)}
            {a.decisionComment ? <> · &ldquo;{a.decisionComment}&rdquo;</> : null}
          </span>
        ) : null}
        {a.appliedAt ? <span>Applied {formatDateTime(a.appliedAt)}</span> : null}
      </div>
    </li>
  );
}

/** The key facts of a request, by kind. */
function AmendmentDetails({ amendment: a, propertyLabel }: { amendment: AmendmentRecord; propertyLabel: string }) {
  const d = a.details ?? {};
  const facts: Array<{ label: string; value: ReactNode }> = [];
  switch (a.kind) {
    case "scope_change": {
      facts.push({ label: "Change", value: SCOPE_MODE_LABELS[String(d.mode)] ?? String(d.mode ?? "—") });
      if (a.resultSubmissionId) {
        facts.push({
          label: "New proposal",
          value: (
            <Link className="hover:underline" href={proposalEditHref(a.resultSubmissionId)}>
              Open the proposal
            </Link>
          ),
        });
      }
      break;
    }
    case "property_change": {
      const from = str(d.from) ?? (a.status === "applied" ? null : propertyLabel);
      facts.push({ label: "From", value: from ?? "—" });
      facts.push({ label: "To", value: str(d.to) ?? str(d.propertyLabel) ?? "—" });
      break;
    }
    case "hold":
      facts.push({ label: "Until", value: str(d.until) ? formatContractDate(str(d.until)) : "Until resumed" });
      if (str(d.heldFrom)) facts.push({ label: "Held from", value: formatContractDate(str(d.heldFrom)) });
      break;
    case "resume":
      if (num(d.replanned) !== null) facts.push({ label: "Visits planned again", value: String(num(d.replanned)) });
      break;
    case "transfer": {
      const to = (d.to ?? {}) as Record<string, unknown>;
      const name = str(to.customerName) ?? (typeof d.to === "string" ? d.to : null);
      facts.push({
        label: "To",
        value: (
          <>
            {name ?? "—"}
            {str(to.role) ? <span className="text-muted-foreground font-normal"> · {str(to.role)}</span> : null}
          </>
        ),
      });
      const contact = [str(to.customerEmail), str(to.customerPhone)].filter(Boolean).join(" · ");
      if (contact) facts.push({ label: "Contact", value: contact });
      if (str(d.from)) facts.push({ label: "From", value: str(d.from) });
      break;
    }
    case "early_termination": {
      facts.push({ label: "Notice given", value: formatContractDate(str(d.noticeOn)) });
      facts.push({ label: "Takes effect", value: formatContractDate(str(d.effectiveOn) ?? a.effectiveOn) });
      if (num(d.received) !== null) facts.push({ label: "Received so far", value: <Money value={num(d.received)} /> });
      if (a.status === "applied" && num(d.refund) !== null) {
        facts.push({ label: "Refund applied", value: <Money value={num(d.refund)} /> });
      } else if (typeof d.validReason === "boolean") {
        facts.push({
          label: "Refund",
          value: d.validReason ? (
            <span className="inline-flex items-center gap-1">
              <Money value={num(d.refundIfValid)} /> <span className="text-muted-foreground font-normal">(valid reason)</span>
            </span>
          ) : (
            "None (reason not accepted as valid)"
          ),
        });
      } else if (num(d.refundIfValid) !== null) {
        facts.push({ label: "Refund if the reason is valid", value: <Money value={num(d.refundIfValid)} /> });
      }
      break;
    }
    case "cancellation":
      break;
  }
  if (!facts.length) return null;
  return (
    <dl className="bg-muted/30 grid gap-1.5 rounded-md px-3 py-2 text-sm">
      {facts.map((f) => (
        <Fact key={f.label} label={f.label}>
          {f.value}
        </Fact>
      ))}
    </dl>
  );
}

function applyDescription(a: AmendmentRecord, propertyLabel: string): string {
  const d = a.details ?? {};
  const on = a.effectiveOn ? formatContractDate(a.effectiveOn) : "today";
  switch (a.kind) {
    case "scope_change":
      return d.mode === "replace_contract"
        ? `A full new draft proposal is made from ${on} with today's services, and this contract is set to end on that date (no refund). The new proposal goes through the usual approval and signature.`
        : "A new draft proposal is made with the same client and property for the extra services. It goes through the usual approval and signature; this contract does not change.";
    case "property_change":
      return `The contract moves from ${propertyLabel || "its current property"} to ${str(d.propertyLabel) ?? "the new property"}.`;
    case "hold":
      return "The contract goes on hold: no visits are offered, confirmed or chased until it is resumed.";
    case "resume":
      return "The contract becomes active again. Visits whose window passed during the hold are planned again from tomorrow.";
    case "transfer": {
      const to = (d.to ?? {}) as Record<string, unknown>;
      return `The contract's client becomes ${str(to.customerName) ?? "the new party"}${str(to.role) ? ` (${str(to.role)})` : ""}.`;
    }
    case "early_termination": {
      const refund = d.validReason === true ? `with a pro-rata refund (worked out again when applied, about AED ${num(d.refundIfValid) ?? 0})` : "with no refund";
      return `Termination takes effect on ${on}, ${refund}. If that date has come the contract is terminated now and its remaining visits are cancelled; otherwise the daily job does it on the date.`;
    }
    case "cancellation":
      return "The contract is cancelled and all its visits are called off. This cannot be undone.";
  }
}

/* ------------------------------------------------------------------ */
/* Approve                                                             */
/* ------------------------------------------------------------------ */

function ApproveAmendmentDialog({
  open,
  onOpenChange,
  contractId,
  amendment,
  onApproved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  amendment: AmendmentRecord | null;
  onApproved: () => void;
}) {
  const [comment, setComment] = useState("");
  const [validReason, setValidReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useId();
  const termination = amendment?.kind === "early_termination";
  const refundIfValid = num(amendment?.details?.refundIfValid);

  const submit = async () => {
    if (!amendment) return;
    setBusy(true);
    try {
      await renewalsService.amendmentAction(contractId, amendment.id, {
        action: "approve",
        comment: comment.trim() || null,
        ...(termination ? { validReason } : {}),
      });
      toast.success("Approved. It can be applied now.");
      onOpenChange(false);
      onApproved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve the amendment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve the {amendment ? AMENDMENT_LABELS[amendment.kind].toLowerCase() : "amendment"}</DialogTitle>
          <DialogDescription>Approving does not change the contract yet: it changes when the amendment is applied.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          {amendment ? <p className="bg-muted/40 rounded-md px-3 py-2 text-sm whitespace-pre-wrap">{amendment.reason}</p> : null}
          {termination ? (
            <div className="grid gap-2">
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <Checkbox checked={validReason} onCheckedChange={(v) => setValidReason(v === true)} className="mt-0.5" aria-label="The reason is valid" />
                <span>The reason is valid (pro-rata refund)</span>
              </label>
              <p className="text-muted-foreground text-xs">
                {validReason ? (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    Refund: <Money value={refundIfValid ?? 0} className="text-foreground font-medium" /> (what was received beyond the days served; worked out again when applied).
                  </span>
                ) : (
                  "No refund: without a valid reason the contract gives none."
                )}
              </p>
            </div>
          ) : null}
          <Field id={`${base}-comment`} label="Comment (optional)">
            <Textarea id={`${base}-comment`} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void submit()} pending={busy} pendingLabel="Approving…" disabled={!amendment} icon={<Check className="size-4" />}>
            Approve
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

interface RequestForm {
  reason: string;
  effectiveOn: string;
  mode: "add_services" | "replace_contract";
  propertyId: string | null;
  until: string;
  noticeOn: string;
  terminationOn: string;
  partyName: string;
  partyEmail: string;
  partyPhone: string;
  partyRole: "owner" | "tenant";
  clientId: string | null;
}

function bodyFor(kind: AmendmentKind, f: RequestForm): AmendmentRequestBody {
  const reason = f.reason.trim();
  switch (kind) {
    case "scope_change":
      return { kind, reason, mode: f.mode, effectiveOn: f.effectiveOn };
    case "property_change":
      return { kind, reason, propertyId: f.propertyId ?? "", effectiveOn: f.effectiveOn };
    case "hold":
      return { kind, reason, effectiveOn: f.effectiveOn, until: f.until || null };
    case "resume":
      return { kind, reason, effectiveOn: f.effectiveOn };
    case "transfer":
      return {
        kind,
        reason,
        effectiveOn: f.effectiveOn,
        to: { customerName: f.partyName.trim(), customerEmail: f.partyEmail.trim() || null, customerPhone: f.partyPhone.trim() || null, role: f.partyRole },
        clientId: f.clientId,
      };
    case "early_termination":
      return { kind, reason, noticeOn: f.noticeOn, effectiveOn: f.terminationOn || null };
    case "cancellation":
      return { kind, reason };
  }
}

function RequestAmendmentDialog({
  open,
  onOpenChange,
  contractId,
  contractStatus,
  contractNumber,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractStatus: string;
  contractNumber: string;
  onRequested: () => void;
}) {
  const base = useId();
  const firstAllowed = AMENDMENT_KINDS.find((k) => !amendmentProblem(k, contractStatus)) ?? null;
  const [kind, setKind] = useState<AmendmentKind | null>(firstAllowed);
  const [form, setForm] = useState<RequestForm>(() => ({
    reason: "",
    effectiveOn: today(),
    mode: "add_services",
    propertyId: null,
    until: "",
    noticeOn: today(),
    terminationOn: "",
    partyName: "",
    partyEmail: "",
    partyPhone: "",
    partyRole: "owner",
    clientId: null,
  }));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RequestForm>(key: K, value: RequestForm[K]) => setForm((cur) => ({ ...cur, [key]: value }));

  const parsed = useMemo(() => (kind ? amendmentRequestSchema.safeParse(bodyFor(kind, form)) : null), [kind, form]);
  const problem = parsed && !parsed.success ? (kind === "property_change" && !form.propertyId ? "Choose the new property" : (parsed.error.issues[0]?.message ?? "Check the details")) : null;

  const submit = async () => {
    if (!kind || !parsed?.success) return;
    setBusy(true);
    try {
      await renewalsService.requestAmendment(contractId, bodyFor(kind, form));
      toast.success("Amendment requested. An approver has been told.");
      onOpenChange(false);
      onRequested();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not ask for the amendment.");
    } finally {
      setBusy(false);
    }
  };

  const dateField = (key: "effectiveOn" | "until" | "noticeOn" | "terminationOn", label: string, hint?: ReactNode) => (
    <Field id={`${base}-${key}`} label={label} hint={hint}>
      <DateSelect id={`${base}-${key}`} value={form[key]} onChange={(value) => set(key, value)} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Request an amendment</DialogTitle>
          <DialogDescription>
            AMC {contractNumber || "contract"}. An AMC approver who is not you decides it; the contract changes only when it is applied.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          <div className="grid gap-2">
            <Label>What changes</Label>
            <RadioGroup value={kind ?? ""} onValueChange={(v) => setKind(v as AmendmentKind)} aria-label="Amendment" className="gap-2">
              {AMENDMENT_KINDS.map((k) => {
                const why = amendmentProblem(k, contractStatus);
                return (
                  <label
                    key={k}
                    htmlFor={`${base}-kind-${k}`}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-sm",
                      why ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      kind === k && "border-brand/40 bg-brand-50",
                    )}
                  >
                    <RadioGroupItem id={`${base}-kind-${k}`} value={k} disabled={Boolean(why)} className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{AMENDMENT_LABELS[k]}</span>
                      <span className="text-muted-foreground text-xs">{why ?? AMENDMENT_HINTS[k]}</span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
            {!firstAllowed ? <p className="text-muted-foreground text-xs">No amendment can be asked for on this contract as it stands.</p> : null}
          </div>

          {kind === "scope_change" ? (
            <>
              <div className="grid gap-2">
                <Label>How</Label>
                <RadioGroup value={form.mode} onValueChange={(v) => set("mode", v as RequestForm["mode"])} aria-label="Scope change" className="gap-2">
                  {(["add_services", "replace_contract"] as const).map((m) => (
                    <label key={m} htmlFor={`${base}-mode-${m}`} className="flex cursor-pointer items-center gap-3 text-sm">
                      <RadioGroupItem id={`${base}-mode-${m}`} value={m} />
                      {SCOPE_MODE_LABELS[m]}
                    </label>
                  ))}
                </RadioGroup>
              </div>
              {dateField("effectiveOn", "Effective from", form.mode === "replace_contract" ? "This contract ends and the new one starts on this date." : undefined)}
            </>
          ) : null}

          {kind === "property_change" ? (
            <>
              <PropertyPicker contractId={contractId} value={form.propertyId} onChange={(id) => set("propertyId", id)} />
              {dateField("effectiveOn", "Effective from")}
            </>
          ) : null}

          {kind === "hold" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {dateField("effectiveOn", "Hold from")}
              {dateField("until", "Until (optional)", "Left empty, it stays on hold until a resume is applied.")}
            </div>
          ) : null}

          {kind === "resume" ? dateField("effectiveOn", "Resume from") : null}

          {kind === "transfer" ? (
            <TransferFields form={form} set={set} base={base} dateField={dateField("effectiveOn", "Takes over from")} />
          ) : null}

          {kind === "early_termination" ? (
            <div className="grid gap-3">
              <div className="grid gap-4 sm:grid-cols-2">
                {dateField("noticeOn", "Notice given on")}
                {dateField("terminationOn", "End on (optional)", "Only if later than 30 days after the notice.")}
              </div>
              {/^\d{4}-\d{2}-\d{2}$/.test(form.noticeOn) ? (
                <p className="bg-muted/40 rounded-md px-3 py-2 text-sm">
                  Takes effect on{" "}
                  <span className="font-medium tabular-nums">{formatContractDate(terminationEffective(form.noticeOn, form.terminationOn || null))}</span>.
                  The approver decides whether the reason is valid, which decides the pro-rata refund.
                </p>
              ) : null}
            </div>
          ) : null}

          {kind === "cancellation" ? (
            <p className="bg-muted/40 rounded-md px-3 py-2 text-sm">Once applied, the contract is cancelled and its visits are called off.</p>
          ) : null}

          {kind ? (
            <Field id={`${base}-reason`} label="Reason">
              <Textarea
                id={`${base}-reason`}
                rows={3}
                maxLength={1000}
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                placeholder="Why this is needed. The approver reads this."
              />
            </Field>
          ) : null}

          {problem && form.reason.trim() ? <p className="text-muted-foreground text-xs">{problem}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void submit()} pending={busy} pendingLabel="Sending…" disabled={!parsed?.success} icon={<FilePen className="size-4" />}>
            Request approval
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** Another address of the same client: the contract's linked client, or one picked here when none is linked. */
function PropertyPicker({ contractId, value, onChange }: { contractId: string; value: string | null; onChange: (id: string | null) => void }) {
  const [linked, setLinked] = useState<{ customer: CustomerRecord | null; ready: boolean }>({ customer: null, ready: false });
  const [picked, setPicked] = useState<CustomerRecord | null>(null);
  const [property, setProperty] = useState<PropertyRecord | null>(null);

  useEffect(() => {
    let stale = false;
    amcContractsService.links(contractId).then(
      ({ links }) => !stale && setLinked({ customer: links.customer, ready: true }),
      () => !stale && setLinked({ customer: null, ready: true }),
    );
    return () => {
      stale = true;
    };
  }, [contractId]);

  const customer = linked.customer ?? picked;

  return (
    <div className="grid gap-3">
      {linked.ready && !linked.customer ? (
        <div className="grid gap-2">
          <Label>Client</Label>
          <p className="text-muted-foreground text-xs">This contract is not linked to a client record. Pick the client to choose one of their properties.</p>
          <CustomerSearch
            selectedId={picked?.id ?? null}
            onPick={(c) => {
              setPicked(c);
              setProperty(null);
              onChange(null);
            }}
          />
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label>New property{customer ? ` (${customer.name})` : ""}</Label>
        <PropertySelect
          customerId={customer?.id ?? null}
          value={value}
          onChange={(p) => {
            setProperty(p);
            onChange(p?.id ?? null);
          }}
        />
        {property?.address ? <p className="text-muted-foreground text-xs">{property.address}</p> : null}
      </div>
    </div>
  );
}

function TransferFields({
  form,
  set,
  base,
  dateField,
}: {
  form: RequestForm;
  set: <K extends keyof RequestForm>(key: K, value: RequestForm[K]) => void;
  base: string;
  dateField: ReactNode;
}) {
  const [linking, setLinking] = useState(Boolean(form.clientId));
  return (
    <div className="grid gap-4">
      {dateField}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>New owner or tenant</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (linking) set("clientId", null);
              setLinking((v) => !v);
            }}
          >
            {linking ? "Do not link a client" : "Link an existing client"}
          </Button>
        </div>
        {linking ? (
          <CustomerSearch
            selectedId={form.clientId}
            onPick={(c) => {
              set("clientId", c.id);
              set("partyName", c.name);
              set("partyEmail", c.email ?? "");
              set("partyPhone", c.phone ?? "");
            }}
          />
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${base}-party-name`} label="Name">
          <Input id={`${base}-party-name`} maxLength={160} value={form.partyName} onChange={(e) => set("partyName", e.target.value)} />
        </Field>
        <Field id={`${base}-party-role`} label="Takes it over as">
          <Select value={form.partyRole} onValueChange={(v) => set("partyRole", v as RequestForm["partyRole"])}>
            <SelectTrigger className="w-full" id={`${base}-party-role`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="tenant">Tenant</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id={`${base}-party-email`} label="Email (optional)">
          <Input id={`${base}-party-email`} type="email" maxLength={200} value={form.partyEmail} onChange={(e) => set("partyEmail", e.target.value)} />
        </Field>
        <Field id={`${base}-party-phone`} label="Phone (optional)">
          <Input id={`${base}-party-phone`} type="tel" maxLength={40} value={form.partyPhone} onChange={(e) => set("partyPhone", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
