"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Download, Eye, FilePlus2, Hash, RefreshCw, Send } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { YallaClassicTemplate } from "@/components/dashboard/extensions/quotation-templates/templates/YallaClassicTemplate";
import { FitToWidth } from "@/components/client-document/client-document-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SNAGGING_QUOTATION_SECTION_STYLE, snaggingQuoteToTemplateData } from "@/lib/snagging/quotation-template-data";
import {
  amcQuoteDoc,
  amcQuotePdf,
  amcQuotationsService,
  shareGeneratedQuotation,
  type AmcQuotation,
  type AmcQuoteKind,
} from "@/modules/amc-contracts/quotations-service";

import { formatDateTime } from "./contract-status";
import { SendDialog } from "./send-options";
import { useAmcData } from "./use-amc-data";

const STATUS_LABEL: Record<AmcQuotation["status"], string> = {
  draft: "Not sent yet",
  sent: "Waiting for the client",
  approved: "Approved",
  rejected: "Rejected",
  void: "Replaced",
};
const STATUS_TONE: Record<AmcQuotation["status"], string> = {
  draft: "bg-mist text-ink-soft",
  sent: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  void: "bg-mist text-ink-soft",
};
const money = (n: number) => `AED ${n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A call out's or additional work's quotation (27 Nov 2026), the two ways
 * the team works:
 *
 *   Generate quotation    from the services entered, as Snagging's: the same
 *                         document, a client link to approve or reject, and
 *                         the estimate in Zoho FSM, whose number it takes.
 *   Add quotation number  a quotation made in FSM by hand (DEV-508).
 *
 * A small call out (no parts, under two hours) needs neither before the
 * visit (DEV-407); its number can follow.
 */
export function QuotationCard({ kind, id, refreshKey = 0, onChanged }: { kind: AmcQuoteKind; id: string; refreshKey?: number; onChanged?: () => void | Promise<void> }) {
  const { data, error, reload } = useAmcData(() => amcQuotationsService.get(kind, id), `amc-quotation|${kind}|${id}`);
  const seen = useRef(refreshKey);
  useEffect(() => {
    if (seen.current === refreshKey) return;
    seen.current = refreshKey;
    reload();
  }, [refreshKey, reload]);
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [numbering, setNumbering] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const changed = async () => {
    reload();
    await onChanged?.();
  };

  if (error || !data) return null;
  const q = data.quotation;
  const fsm = data.fsmQuotation;
  /* A covered call out with nothing charged has nothing to quote. */
  if (kind === "call_out" && !q && !(fsm.migrated && (fsm.required || fsm.value))) return null;
  const canEdit = data.canEdit;
  const quotable = data.quotable;
  const live = q && (q.status === "draft" || q.status === "sent");

  const generate = () =>
    void confirm({
      title: q && live ? `Replace quotation ${q.quoteNumber}?` : "Generate the quotation?",
      description:
        q && live
          ? "A new quotation is made from the services as they are now. The current one is set aside and its link stops working."
          : data.fsmWrites
            ? "Made from the services and prices entered, and created in Zoho FSM as an estimate whose number it takes. Nothing is sent to the client yet."
            : "Made from the services and prices entered. Nothing is sent to the client yet.",
      confirmText: q && live ? "Replace it" : "Generate quotation",
      action: async () => {
        const result = await amcQuotationsService.generate(kind, id);
        if (result.fsmProblem) toast.warning(`Quotation ${result.quotation.quoteNumber} generated, but not in Zoho FSM yet`, { description: result.fsmProblem });
        else toast.success(`Quotation ${result.quotation.quoteNumber} generated`);
        await changed();
      },
    });

  const retryFsm = async () => {
    setBusy("fsm");
    try {
      const { fsmProblem } = await amcQuotationsService.retryFsm(kind, id);
      if (fsmProblem) toast.error("Zoho FSM did not take it", { description: fsmProblem });
      else toast.success("Created in Zoho FSM");
      await changed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach Zoho FSM.");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!q) return;
    setBusy("pdf");
    try {
      saveAs(await amcQuotePdf(q), `Quotation-${q.quoteNumber}.pdf`);
    } catch {
      toast.error("Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionCard
        title="Quotation"
        description={
          kind === "call_out"
            ? "What the client pays for this call out, for them to approve. A small call out (no parts, under two hours) can go ahead on their WhatsApp confirmation; its number can follow."
            : "The quotation the client approves before the work is scheduled."
        }
        bodyClassName="px-5 pb-5 grid gap-4"
        action={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {(!q || q.status !== "approved" || !fsm.value) && fsm.migrated ? (
                <Button size="sm" variant="outline" onClick={() => setNumbering(true)}>
                  <Hash className="size-4" />
                  {fsm.value ? "Change quotation number" : "Add quotation number"}
                </Button>
              ) : null}
              {data.ready && quotable && (!q || q.status !== "approved") ? (
                <Button size="sm" variant={live ? "outline" : "default"} onClick={generate} disabled={Boolean(data.blocker)} title={data.blocker ?? undefined}>
                  {live ? <RefreshCw className="size-4" /> : <FilePlus2 className="size-4" />}
                  {live ? "Regenerate" : "Generate quotation"}
                </Button>
              ) : null}
              {live && quotable ? (
                <Button size="sm" onClick={() => setSharing(true)}>
                  <Send className="size-4" />
                  {q?.status === "sent" ? "Share again" : "Share quotation"}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {!data.ready ? (
          <Alert variant="warning">
            <CircleAlert />
            <AlertTitle>Generating quotations needs a database update</AlertTitle>
            <AlertDescription>Migration 20261127100000 adds them. Until then, add the FSM quotation number by hand.</AlertDescription>
          </Alert>
        ) : null}

        {q ? (
          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">{q.quoteNumber}</span>
                <Badge variant="secondary" className={`border-0 font-medium ${STATUS_TONE[q.status]}`}>
                  {STATUS_LABEL[q.status]}
                </Badge>
              </div>
              <span className="font-semibold tabular-nums">{money(q.total)}</span>
            </div>
            <dl className="text-muted-foreground grid gap-1 text-sm">
              <div>
                <dt className="inline">Zoho FSM: </dt>
                <dd className="text-foreground inline">
                  {q.fsmEstimateNumber ? `estimate ${q.fsmEstimateNumber}${q.fsmStatus ? ` · ${q.fsmStatus}` : ""}` : q.fsmError ? `not there yet: ${q.fsmError}` : data.fsmWrites ? "not there yet: use Create in FSM" : "not created (FSM is not taking changes from this server)"}
                </dd>
              </div>
              {q.sentAt ? (
                <div>
                  <dt className="inline">Shared: </dt>
                  <dd className="text-foreground inline">
                    {formatDateTime(q.sentAt)}
                    {q.sentChannel ? ` by ${q.sentChannel === "link" ? "copied link" : q.sentChannel === "whatsapp" ? "WhatsApp" : "email"}` : ""}
                    {q.linkExpiresAt && q.status === "sent" ? ` · link works until ${formatDateTime(q.linkExpiresAt).replace(/, \d\d:\d\d$/, "")}` : ""}
                  </dd>
                </div>
              ) : null}
              {q.status === "approved" ? (
                <div>
                  <dt className="inline">Approved: </dt>
                  <dd className="text-foreground inline">
                    {q.decidedAt ? formatDateTime(q.decidedAt) : ""}
                    {q.approvedByName ? ` by ${q.approvedByName}` : ""}
                    {q.decidedOrigin === "client" ? " on the client link" : q.decidedOrigin === "staff" ? " (recorded by the team)" : ""}
                  </dd>
                </div>
              ) : null}
              {q.status === "rejected" ? (
                <div>
                  <dt className="inline">Rejected: </dt>
                  <dd className="text-foreground inline">
                    {q.approvedByName ? `${q.approvedByName}: ` : ""}
                    {q.rejectedReason ?? ""}
                  </dd>
                </div>
              ) : null}
              {q.status === "void" && q.voidReason ? (
                <div>
                  <dt className="inline">Replaced: </dt>
                  <dd className="text-foreground inline">{q.voidReason}</dd>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
                <Eye className="size-4" />
                Preview
              </Button>
              <SubmitButton size="sm" variant="outline" pending={busy === "pdf"} pendingLabel="Building…" icon={<Download className="size-4" />} onClick={() => void download()}>
                Download PDF
              </SubmitButton>
              {canEdit && data.fsmWrites && !q.fsmEstimateNumber && q.status !== "void" ? (
                <SubmitButton size="sm" variant="outline" pending={busy === "fsm"} pendingLabel="Sending to FSM…" icon={<RefreshCw className="size-4" />} onClick={() => void retryFsm()}>
                  Create in FSM
                </SubmitButton>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            {quotable && data.blocker
              ? `No quotation yet. ${data.blocker} Or add the number of a quotation made in Zoho FSM.`
              : quotable
              ? "No quotation yet. Generate it from the services above, or add the number of a quotation made in Zoho FSM."
              : "No quotation was generated here. Add the number of the quotation made in Zoho FSM, if it is not on file yet."}
          </p>
        )}

        {fsm.migrated && fsm.value && (!q || q.fsmEstimateNumber !== fsm.value) ? (
          <p className="text-muted-foreground text-sm">
            FSM quotation number on file: <span className="text-foreground font-medium">{fsm.value}</span>
          </p>
        ) : null}
      </SectionCard>

      {dialog}
      <NumberDialog open={numbering} onOpenChange={setNumbering} current={fsm.value} onSave={async (value) => {
        await amcQuotationsService.setNumber(kind, id, value);
        toast.success("FSM quotation number saved");
        await changed();
      }} />
      {q ? (
        <SendDialog
          open={sharing}
          onOpenChange={setSharing}
          title={`Share quotation ${q.quoteNumber}`}
          description={`${money(q.total)} including VAT. The client opens it on a link and approves or rejects it there.`}
          what="the quotation"
          noun="Quotation"
          contacts={{ email: (q.clientSnapshot.client_email as string) ?? null, phone: (q.clientSnapshot.client_phone as string) ?? null }}
          onSend={async (channel) => {
            const r = await shareGeneratedQuotation(kind, id, channel);
            return { outcome: channel === "email" ? (r.emailed ? "sent" : "no_recipient") : channel === "whatsapp" ? "prepared" : "link_created", message: r.message, whatsapp: r.whatsapp, link: r.url, file: null };
          }}
          onDone={changed}
        />
      ) : null}
      {q ? (
        <Dialog open={previewing} onOpenChange={setPreviewing}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Quotation {q.quoteNumber}</DialogTitle>
              <DialogDescription>Exactly what the client sees on the link and in the PDF.</DialogDescription>
            </DialogHeader>
            <FitToWidth>
              <YallaClassicTemplate data={snaggingQuoteToTemplateData(amcQuoteDoc(q))} discountMode="without" hideDiscount sectionStyle={SNAGGING_QUOTATION_SECTION_STYLE} />
            </FitToWidth>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function NumberDialog({ open, onOpenChange, current, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; current: string | null; onSave: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setValue(current ?? "");
  }, [open, current]);
  const save = async () => {
    if (!value.trim()) return void toast.error("Enter the FSM quotation number");
    setSaving(true);
    try {
      await onSave(value.trim());
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the number.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{current ? "Change the FSM quotation number" : "Add the FSM quotation number"}</DialogTitle>
          <DialogDescription>The number of a quotation made in Zoho FSM. Finance needs it to record the revenue and issue the tax invoice.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="amc-fsm-quote-no">FSM quotation number</Label>
          <Input id="amc-fsm-quote-no" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. EST-012345" maxLength={40} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton pending={saving} pendingLabel="Saving…" onClick={() => void save()}>
            Save number
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
