"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Clock, FileUp, Loader2, Pause, PenLine, Play, Power, ScrollText, XCircle } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
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

type Dialog = "sign" | "scan" | "activate" | { status: "on_hold" | "active" | "terminated" | "cancelled" } | null;

/**
 * The contract from the client's approval to activation and after (BRD
 * 5.7, Phase 6): its number and template, the signatures in order, and the
 * next step: sign, record a signed scan, activate with the commencement
 * date and term, put on hold, resume, terminate or call off.
 */
export function ContractLifecycleCard({ data, onChanged }: { data: ContractDetail; onChanged: () => void }) {
  const { contract, permissions } = data;
  const signatories = data.signatories ?? [];
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!contract.lifecycle && signatories.length === 0) return null;
  const status = contract.status as ContractStatus;
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
    onChanged();
  };

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
      bodyClassName="px-5 pb-5 grid gap-4"
      action={
        <div className="flex flex-wrap gap-2">
          {permissions.canSign ? (
            <Button size="sm" onClick={() => setDialog("sign")}>
              <PenLine className="size-4" />
              Sign
            </Button>
          ) : null}
          {permissions.canRecordScan ? (
            <Button size="sm" variant="outline" onClick={() => setDialog("scan")}>
              <FileUp className="size-4" />
              Signed scan
            </Button>
          ) : null}
          {permissions.canActivate ? (
            <Button size="sm" onClick={() => setDialog("activate")}>
              <Play className="size-4" />
              Activate
            </Button>
          ) : null}
          {permissions.canHold && status === "active" ? (
            <Button size="sm" variant="outline" onClick={() => setDialog({ status: "on_hold" })}>
              <Pause className="size-4" />
              Put on hold
            </Button>
          ) : null}
          {permissions.canHold && status === "on_hold" ? (
            <Button size="sm" variant="outline" onClick={() => setDialog({ status: "active" })}>
              <Play className="size-4" />
              Resume
            </Button>
          ) : null}
          {permissions.canTerminate ? (
            <Button size="sm" variant="outline" onClick={() => setDialog({ status: "terminated" })}>
              <Power className="size-4" />
              Terminate
            </Button>
          ) : null}
          {permissions.canCallOff ? (
            <Button size="sm" variant="outline" onClick={() => setDialog({ status: "cancelled" })}>
              <XCircle className="size-4" />
              Call off
            </Button>
          ) : null}
        </div>
      }
    >
      {contract.lifecycle?.statusReason ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          {CONTRACT_STATUS_NAMES[status]}: {contract.lifecycle.statusReason}
        </p>
      ) : null}
      {status === "signed" || status === "pending_initial_payment" ? (
        <p className="text-muted-foreground text-sm">
          Signed {contract.signedAt ? formatDateTime(contract.signedAt) : ""}
          {contract.lifecycle?.signatureRoute === "scan" && contract.lifecycle.signedScanDate ? ` (scan dated ${formatContractDate(contract.lifecycle.signedScanDate)})` : ""}. Activate it with the
          commencement date: visits and coverage start from then.
        </p>
      ) : null}

      {signatories.length ? (
        <ol className="divide-y rounded-lg border">
          {signatories.map((s) => {
            const Icon = s.status === "signed" ? CheckCircle2 : s.status === "pending" ? Clock : Circle;
            return (
              <li key={s.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <Icon className="text-muted-foreground mt-0.5 size-4" aria-hidden />
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
                <Badge variant="secondary" className="font-normal capitalize">
                  {s.status === "pending" ? "Their turn" : s.status}
                </Badge>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">No signatories recorded for this contract.</p>
      )}

      {dialog === "sign" ? <SignDialog contractId={contract.id} onClose={() => setDialog(null)} onDone={() => done("Signed. The next signatory has been told.")} /> : null}
      {dialog === "scan" ? <ScanDialog data={data} onClose={() => setDialog(null)} onDone={() => done("Signed scan recorded. The contract is signed.")} /> : null}
      {dialog === "activate" ? <ActivateDialog data={data} onClose={() => setDialog(null)} onDone={() => done("Contract activated.")} /> : null}
      {dialog && typeof dialog === "object" ? (
        <StatusDialog contractId={contract.id} to={dialog.status} onClose={() => setDialog(null)} onDone={() => done("Status changed.")} />
      ) : null}
    </SectionCard>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function DialogShell({
  title,
  description,
  busy,
  error,
  onClose,
  footer,
  children,
}: {
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !busy && !open && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">{children}</div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function SignDialog({ contractId, onClose, onDone }: { contractId: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <DialogShell
      title="Sign the contract"
      description="Your typed name is recorded as your signature for Yalla Fix It, with the date and time."
      busy={busy}
      error={error}
      onClose={onClose}
      footer={
        <Button disabled={busy || name.trim().length < 2 || !agree} onClick={() => void run(() => lifecycle(contractId, { action: "sign", typedName: name.trim() }), onDone)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
          Sign
        </Button>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="sign-name">Full name</Label>
        <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} />I have read the contract and sign it on behalf of Yalla Fix It.
      </label>
    </DialogShell>
  );
}

function ScanDialog({ data, onClose, onDone }: { data: ContractDetail; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(todayInDubai());
  const [name, setName] = useState(data.contract.customerName);
  const { busy, error, run } = useAction();
  const save = () =>
    run(async () => {
      const { document } = await clientProfileService.uploadDocument({
        file: file!,
        level: "contract",
        entityId: data.contract.id,
        category: "Signed scan",
        title: `Signed contract ${data.contract.lifecycle?.contractNumber ?? ""}`.trim(),
      });
      await lifecycle(data.contract.id, { action: "scan", documentId: document.id, signedDate: date, signedByName: name.trim() });
    }, onDone);
  return (
    <DialogShell
      title="Record a signed scan"
      description="For a contract signed on paper. The scan is kept with the contract's documents and records every signature still open."
      busy={busy}
      error={error}
      onClose={onClose}
      footer={
        <Button disabled={busy || !file || !date || name.trim().length < 2} onClick={() => void save()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          Record
        </Button>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="scan-file">Signed contract (PDF or image)</Label>
        <Input id="scan-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="scan-date">Signed on</Label>
        <Input id="scan-date" type="date" max={todayInDubai()} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="scan-name">Signed for the client by</Label>
        <Input id="scan-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
    </DialogShell>
  );
}

function ActivateDialog({ data, onClose, onDone }: { data: ContractDetail; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState(data.contract.startDate >= todayInDubai() ? data.contract.startDate : todayInDubai());
  const [term, setTerm] = useState(String(data.contract.termMonths && data.contract.termMonths >= 12 ? data.contract.termMonths : 12));
  const { busy, error, run } = useAction();
  const months = Number(term);
  const end = start && months >= 1 ? expiryFromCommencement(start, months) : null;
  return (
    <DialogShell
      title="Activate the contract"
      description="The commencement date is when service starts, separate from the signing date. With the term it sets the expiry, the PPM schedule and the renewal reminder."
      busy={busy}
      error={error}
      onClose={onClose}
      footer={
        <Button
          disabled={busy || !start || !(months >= 1)}
          onClick={() => void run(() => lifecycle(data.contract.id, { action: "activate", commencementDate: start, termMonths: months }), onDone)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Activate
        </Button>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="act-start">Commencement date</Label>
        <Input id="act-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="act-term">Term (months)</Label>
        <Input id="act-term" type="number" min={1} max={120} value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {end ? <p className="text-muted-foreground text-sm">Runs to {formatContractDate(end)}.</p> : null}
    </DialogShell>
  );
}

const STATUS_COPY: Record<"on_hold" | "active" | "terminated" | "cancelled", { title: string; description: string; button: string }> = {
  on_hold: { title: "Put the contract on hold", description: "Visits pause while it is on hold. The reason is recorded.", button: "Put on hold" },
  active: { title: "Resume the contract", description: "It is active again from now. Say what changed.", button: "Resume" },
  terminated: { title: "Terminate the contract", description: "It ends now, before its term. This cannot be undone.", button: "Terminate" },
  cancelled: { title: "Call the contract off", description: "It will not start. This cannot be undone.", button: "Call off" },
};

function StatusDialog({ contractId, to, onClose, onDone }: { contractId: string; to: "on_hold" | "active" | "terminated" | "cancelled"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();
  const copy = STATUS_COPY[to];
  return (
    <DialogShell
      title={copy.title}
      description={copy.description}
      busy={busy}
      error={error}
      onClose={onClose}
      footer={
        <Button
          variant={to === "terminated" || to === "cancelled" ? "destructive" : "default"}
          disabled={busy || reason.trim().length < 3}
          onClick={() => void run(() => lifecycle(contractId, { action: "status", to, reason: reason.trim() }), onDone)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {copy.button}
        </Button>
      }
    >
      <div className="grid gap-1.5">
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
  const [editing, setEditing] = useState<Entitlement | null>(null);
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
              {canEdit ? <TableHead className="pr-5" /> : null}
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
                    <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
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
          contractId={data.contract.id}
          entitlement={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            toast.success("Saved");
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function TermsDialog({ contractId, entitlement, onClose, onDone }: { contractId: string; entitlement: Entitlement; onClose: () => void; onDone: () => void }) {
  const [labour, setLabour] = useState(entitlement.labourCovered !== false);
  const [material, setMaterial] = useState<keyof typeof MATERIAL_LABELS>(entitlement.materialCoverage ?? "consumables");
  const [limit, setLimit] = useState(entitlement.valueLimitAed != null ? String(entitlement.valueLimitAed) : "");
  const [exclusions, setExclusions] = useState(entitlement.exclusions ?? "");
  const { busy, error, run } = useAction();
  return (
    <DialogShell
      title={entitlement.serviceLabel}
      description="What this service covers on this contract."
      busy={busy}
      error={error}
      onClose={onClose}
      footer={
        <Button
          disabled={busy || (limit !== "" && !(Number(limit) >= 0))}
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
              onDone,
            )
          }
        >
          Save
        </Button>
      }
    >
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={labour} onCheckedChange={(v) => setLabour(v === true)} />
        Labour covered
      </label>
      <div className="grid gap-1.5">
        <Label>Materials</Label>
        <Select value={material} onValueChange={(v) => setMaterial(v as keyof typeof MATERIAL_LABELS)}>
          <SelectTrigger aria-label="Materials">
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
      <div className="grid gap-1.5">
        <Label htmlFor="terms-limit">Value limit per job (AED, blank: none)</Label>
        <Input id="terms-limit" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="terms-excl">Exclusions</Label>
        <Textarea id="terms-excl" rows={3} value={exclusions} onChange={(e) => setExclusions(e.target.value)} maxLength={1000} />
      </div>
    </DialogShell>
  );
}
