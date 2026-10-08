"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Clock, FileUp, PenLine, Play, Save, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CONTRACT_STATUS_NAMES, MATERIAL_LABELS, expiryFromCommencement, type ContractStatus, type LifecycleAction } from "@/lib/amc/contract-lifecycle";
import { todayInDubai } from "@/lib/amc/contracts";
import type { ContractDetail } from "@/modules/amc-contracts/amc-contracts-service";
import { clientProfileService } from "@/modules/amc-contracts/client-profile-service";

import { formatContractDate, formatDateTime } from "./contract-status";

async function lifecycle(contractId: string, action: LifecycleAction) {
  const response = await fetch(`/api/amc-contracts/${contractId}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body;
}

const METHOD_LABELS: Record<string, string> = { link: "Signed on the link", portal: "Signed in the portal", scan: "Signed scan", zoho_sign: "Zoho Sign" };

export type StatusTarget = "on_hold" | "active" | "terminated" | "cancelled";
type LifecycleDialog = "sign" | "scan" | "activate" | "status" | null;

/**
 * The contract from the client's approval to activation and after (BRD
 * 5.7, Phase 6): its number and template, and the signatures in order.
 * The next step (sign, record a signed scan, activate, hold, resume,
 * terminate, call off) is offered on the contract's header card, which
 * opens the dialogs from useLifecycleDialogs.
 */
export function ContractLifecycleCard({ data }: { data: ContractDetail }) {
  const { contract } = data;
  const signatories = data.signatories ?? [];
  if (!contract.lifecycle && signatories.length === 0) return null;
  const status = contract.status as ContractStatus;

  return (
    <SectionCard
      icon={<ScrollText />}
      title={`Contract ${contract.lifecycle?.contractNumber ?? ""}`.trim()}
      description={[
        CONTRACT_STATUS_NAMES[status] ?? status,
        contract.lifecycle?.template ? `${contract.lifecycle.template === "commercial" ? "Commercial" : "Residential"} template` : null,
        contract.lifecycle?.approvedVersionNo ? `from proposal V${contract.lifecycle.approvedVersionNo}` : null,
        contract.lifecycle?.clientApprovedAt ? `approved ${formatDateTime(contract.lifecycle.clientApprovedAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      bodyClassName="px-5 pb-5"
    >
      {signatories.length ? (
        <ol className="divide-y rounded-lg border">
          {signatories.map((s) => {
            const Icon = s.status === "signed" ? CheckCircle2 : s.status === "pending" ? Clock : Circle;
            return (
              <li key={s.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <Icon
                  className={`mt-0.5 size-4 ${s.status === "signed" ? "text-success" : s.status === "pending" ? "text-warning" : "text-muted-foreground"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {s.signOrder}. {s.name}
                    <span className="text-muted-foreground font-normal"> · {s.party === "client" ? "Client" : (s.title ?? "Yalla Fix It")}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {s.status === "signed"
                      ? `${METHOD_LABELS[s.method ?? ""] ?? "Signed"}${s.signedName && s.signedName !== s.name ? ` as ${s.signedName}` : ""}, ${formatDateTime(s.signedAt)}`
                      : s.status === "pending"
                        ? s.party === "client"
                          ? "Signs on the link sent with the contract"
                          : "Signs here, in the portal"
                        : "After the signature before"}
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className={`border-0 font-medium capitalize ${
                    s.status === "signed" ? "bg-success/10 text-success" : s.status === "pending" ? "bg-warning/10 text-warning" : "bg-mist text-ink-soft"
                  }`}
                >
                  {s.status === "pending" ? "Their turn" : s.status}
                </Badge>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">No signatories recorded for this contract.</p>
      )}
    </SectionCard>
  );
}

/**
 * The lifecycle dialogs, owned by whichever screen offers the buttons (the
 * contract's header card). Every dialog stays mounted and is opened by
 * name, so it animates in and out like every other dialog in the product.
 */
export function useLifecycleDialogs(data: ContractDetail, onChanged: () => void) {
  const [dialog, setDialog] = useState<LifecycleDialog>(null);
  const [statusTo, setStatusTo] = useState<StatusTarget>("on_hold");
  const close = (open: boolean) => !open && setDialog(null);
  const done = () => {
    setDialog(null);
    onChanged();
  };

  const dialogs = (
    <>
      <SignDialog open={dialog === "sign"} onOpenChange={close} contractId={data.contract.id} onDone={done} />
      <ScanDialog open={dialog === "scan"} onOpenChange={close} data={data} onDone={done} />
      <ActivateDialog open={dialog === "activate"} onOpenChange={close} data={data} onDone={done} />
      <StatusDialog open={dialog === "status"} onOpenChange={close} contractId={data.contract.id} to={statusTo} onDone={done} />
    </>
  );

  return {
    open: (next: Exclude<LifecycleDialog, "status" | null>) => setDialog(next),
    openStatus: (to: StatusTarget) => {
      setStatusTo(to);
      setDialog("status");
    },
    dialogs,
  };
}

/* One action at a time: success is a toast and the dialog closes; a failure is a toast and it stays open. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success: string, after: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      after();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  busy,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  busy: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void };

/*
  Starts the form afresh each time its dialog opens. Done while rendering,
  not in an effect, so the first frame of the dialog already shows the
  fresh form rather than the last one's answers.
*/
function useResetOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}

function SignDialog({ open, onOpenChange, contractId, onDone }: DialogProps & { contractId: string }) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const { busy, run } = useAction();

  useResetOnOpen(open, () => {
    setName("");
    setAgree(false);
  });

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Sign the contract"
      description="Your typed name is recorded as your signature for Yalla Fix It, with the date and time."
      busy={busy}
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Signing…"
          icon={<PenLine className="size-4" />}
          disabled={name.trim().length < 2 || !agree}
          onClick={() => void run(() => lifecycle(contractId, { action: "sign", typedName: name.trim() }), "Signed. The next signatory has been told.", onDone)}
        >
          Sign
        </SubmitButton>
      }
    >
      <div className="grid gap-2">
        <Label htmlFor="sign-name">Full name</Label>
        <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} />I have read the contract and sign it on behalf of Yalla Fix It.
      </label>
    </DialogShell>
  );
}

function ScanDialog({ open, onOpenChange, data, onDone }: DialogProps & { data: ContractDetail }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(todayInDubai());
  const [name, setName] = useState(data.contract.customerName);
  const { busy, run } = useAction();

  useResetOnOpen(open, () => {
    setFile(null);
    setDate(todayInDubai());
    setName(data.contract.customerName);
  });

  const save = () =>
    run(
      async () => {
        const { document } = await clientProfileService.uploadDocument({
          file: file!,
          level: "contract",
          entityId: data.contract.id,
          category: "Signed scan",
          title: `Signed contract ${data.contract.lifecycle?.contractNumber ?? ""}`.trim(),
        });
        await lifecycle(data.contract.id, { action: "scan", documentId: document.id, signedDate: date, signedByName: name.trim() });
      },
      "Signed scan recorded. The contract is signed.",
      onDone,
    );
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Record a signed scan"
      description="For a contract signed on paper. The scan is kept with the contract's documents and records every signature still open."
      busy={busy}
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Recording…"
          icon={<FileUp className="size-4" />}
          disabled={!file || !date || name.trim().length < 2}
          onClick={() => void save()}
        >
          Record
        </SubmitButton>
      }
    >
      <div className="grid gap-2">
        <Label htmlFor="scan-file">Signed contract (PDF or image)</Label>
        <Input id="scan-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="scan-date">Signed on</Label>
          <Input id="scan-date" type="date" max={todayInDubai()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="scan-name">Signed for the client by</Label>
          <Input id="scan-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
    </DialogShell>
  );
}

function ActivateDialog({ open, onOpenChange, data, onDone }: DialogProps & { data: ContractDetail }) {
  const initialStart = () => (data.contract.startDate >= todayInDubai() ? data.contract.startDate : todayInDubai());
  const initialTerm = () => String(data.contract.termMonths && data.contract.termMonths >= 12 ? data.contract.termMonths : 12);
  const [start, setStart] = useState(initialStart);
  const [term, setTerm] = useState(initialTerm);
  const { busy, run } = useAction();

  useResetOnOpen(open, () => {
    setStart(initialStart());
    setTerm(initialTerm());
  });

  const months = Number(term);
  const end = start && months >= 1 ? expiryFromCommencement(start, months) : null;
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Activate the contract"
      description="The commencement date is when service starts, separate from the signing date. With the term it sets the expiry, the PPM schedule and the renewal reminder."
      busy={busy}
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Activating…"
          icon={<Play className="size-4" />}
          disabled={!start || !(months >= 1)}
          onClick={() => void run(() => lifecycle(data.contract.id, { action: "activate", commencementDate: start, termMonths: months }), "Contract activated.", onDone)}
        >
          Activate
        </SubmitButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="act-start">Commencement date</Label>
          <Input id="act-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="act-term">Term (months)</Label>
          <Input id="act-term" type="number" min={1} max={120} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </div>
      {end ? <p className="text-muted-foreground text-sm">Runs to {formatContractDate(end)}.</p> : null}
    </DialogShell>
  );
}

const STATUS_COPY: Record<StatusTarget, { title: string; description: string; button: string; pending: string }> = {
  on_hold: { title: "Put the contract on hold", description: "Visits pause while it is on hold. The reason is recorded.", button: "Put on hold", pending: "Saving…" },
  active: { title: "Resume the contract", description: "It is active again from now. Say what changed.", button: "Resume", pending: "Saving…" },
  terminated: { title: "Terminate the contract", description: "It ends now, before its term. This cannot be undone.", button: "Terminate", pending: "Terminating…" },
  cancelled: { title: "Call the contract off", description: "It will not start. This cannot be undone.", button: "Call off", pending: "Calling off…" },
};

function StatusDialog({ open, onOpenChange, contractId, to, onDone }: DialogProps & { contractId: string; to: StatusTarget }) {
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  const copy = STATUS_COPY[to];

  useResetOnOpen(open, () => setReason(""));

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      busy={busy}
      footer={
        <SubmitButton
          variant={to === "terminated" || to === "cancelled" ? "destructive" : "default"}
          pending={busy}
          pendingLabel={copy.pending}
          disabled={reason.trim().length < 3}
          onClick={() => void run(() => lifecycle(contractId, { action: "status", to, reason: reason.trim() }), "Status changed.", onDone)}
        >
          {copy.button}
        </SubmitButton>
      }
    >
      <div className="grid gap-2">
        <Label htmlFor="status-reason">Reason</Label>
        <Textarea id="status-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      </div>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ */
/* Entitlements: what each service covers besides its visits (DEV-373) */
/* ------------------------------------------------------------------ */

type Entitlement = ContractDetail["entitlements"][number];

export function EntitlementTermsCard({ data, onChanged }: { data: ContractDetail; onChanged: () => void }) {
  /* Kept after the dialog closes, so it can animate out with its content. */
  const [editing, setEditing] = useState<Entitlement | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const rows = data.entitlements.filter((e) => e.materialCoverage !== undefined);
  if (rows.length === 0) return null;
  const canEdit = data.permissions.canEditTerms === true;
  return (
    <SectionCard
      icon={<ScrollText />}
      title="What each service covers"
      description="Labour, materials, value limits and exclusions per service. Set before activation; checked when a call out or extra work is assessed."
      bodyClassName="pb-2"
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Service</TableHead>
              <TableHead>Labour</TableHead>
              <TableHead>Materials</TableHead>
              <TableHead className="text-right">Value limit</TableHead>
              <TableHead>Exclusions</TableHead>
              {canEdit ? (
                <TableHead className="pr-5">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-5 text-sm font-medium">{e.serviceLabel}</TableCell>
                <TableCell className="text-sm">{e.labourCovered ? "Covered" : "Chargeable"}</TableCell>
                <TableCell className="text-sm">{MATERIAL_LABELS[e.materialCoverage ?? "consumables"]}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{e.valueLimitAed != null ? `AED ${e.valueLimitAed.toLocaleString("en-AE")}` : "—"}</TableCell>
                <TableCell className="max-w-[240px] text-sm">
                  <span className="line-clamp-2">{e.exclusions || "—"}</span>
                </TableCell>
                {canEdit ? (
                  <TableCell className="pr-5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(e);
                        setEditOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <TermsDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          contractId={data.contract.id}
          entitlement={editing}
          onDone={() => {
            setEditOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function TermsDialog({ open, onOpenChange, contractId, entitlement, onDone }: DialogProps & { contractId: string; entitlement: Entitlement }) {
  const [labour, setLabour] = useState(entitlement.labourCovered !== false);
  const [material, setMaterial] = useState<keyof typeof MATERIAL_LABELS>(entitlement.materialCoverage ?? "consumables");
  const [limit, setLimit] = useState(entitlement.valueLimitAed != null ? String(entitlement.valueLimitAed) : "");
  const [exclusions, setExclusions] = useState(entitlement.exclusions ?? "");
  const { busy, run } = useAction();

  /* Each opening starts from the service being edited. */
  useResetOnOpen(open, () => {
    setLabour(entitlement.labourCovered !== false);
    setMaterial(entitlement.materialCoverage ?? "consumables");
    setLimit(entitlement.valueLimitAed != null ? String(entitlement.valueLimitAed) : "");
    setExclusions(entitlement.exclusions ?? "");
  });

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={entitlement.serviceLabel}
      description="What this service covers on this contract."
      busy={busy}
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={<Save className="size-4" />}
          disabled={limit !== "" && !(Number(limit) >= 0)}
          onClick={() =>
            void run(
              () =>
                lifecycle(contractId, {
                  action: "entitlement",
                  entitlementId: entitlement.id!,
                  labourCovered: labour,
                  materialCoverage: material,
                  valueLimitAed: limit === "" ? null : Number(limit),
                  exclusions: exclusions.trim() || null,
                }),
              "Saved",
              onDone,
            )
          }
        >
          Save
        </SubmitButton>
      }
    >
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={labour} onCheckedChange={(v) => setLabour(v === true)} />
        Labour covered
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="terms-material">Materials</Label>
          <Select value={material} onValueChange={(v) => setMaterial(v as keyof typeof MATERIAL_LABELS)}>
            <SelectTrigger id="terms-material">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MATERIAL_LABELS).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="terms-limit">Value limit per job (AED)</Label>
          <Input id="terms-limit" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Blank: none" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="terms-excl">Exclusions</Label>
        <Textarea id="terms-excl" rows={3} value={exclusions} onChange={(e) => setExclusions(e.target.value)} maxLength={1000} />
      </div>
    </DialogShell>
  );
}
