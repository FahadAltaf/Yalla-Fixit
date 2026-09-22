"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSignature,
  Loader2,
  MessageSquareWarning,
} from "lucide-react";
import { saveAs } from "file-saver";

import {
  buildAmcPdfForClient,
  computeAmcClientData,
  type AmcClientDocument,
} from "@/components/dashboard/extensions/amc/amc-document-utils";
import { AmcDocumentPreview } from "@/components/dashboard/extensions/amc/templates/AmcDocumentPreview";
import { StatusMessageCard } from "@/components/quotations/status-message-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Loader from "@/components/ui/loader";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrencyAED } from "@/utils/format-currency";
import {
  ClientDocumentShell,
  ClientDownloadMenu,
  formatClientDate,
  type ClientFileFormat,
} from "@/components/client-document/client-document-shell";

/**
 * The client's view of a proposal or contract (FR5.5, FR5.7).
 *
 * Built to match /quote/[token], the quotation the snagging module sends:
 * the same page shell, actions above the document, the whole document
 * shown as in the Review & Submit preview, the same two-step name-then-
 * confirm dialog, and the same
 * StatusMessageCard once the client has answered. Clients may receive both
 * from us; they should look like one company sent them.
 */

type PublicStatus = {
  kind: "proposal" | "contract";
  status: string;
  proposalNumber: string | null;
  customerName: string | null;
  startDate: string | null;
  endDate: string | null;
  paymentTerms: string | null;
  property: { propertyAddress?: string } | null;
  finalPrice: number;
  signedByName: string | null;
  signedAt: string | null;
};

type Action = "approve" | "reject" | "sign";

export function PublicAmcDocument({ token }: { token: string }) {
  const [doc, setDoc] = useState<PublicStatus | null>(null);
  const [clientDocument, setClientDocument] = useState<AmcClientDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Which answer the client is giving, and how far through it they are.
     Name first, as on the quotation: it is what gets recorded against a
     binding choice, and asking for it inline left it looking optional. */
  const [action, setAction] = useState<Action | null>(null);
  const [step, setStep] = useState<"name" | "details">("name");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/amc/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "This link is not available.");
        return;
      }
      setDoc(body.data as PublicStatus);
      setClientDocument((body.document as AmcClientDocument | undefined) ?? null);
    } catch {
      setError("We could not load this document. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = useMemo(
    () => (clientDocument ? computeAmcClientData(clientDocument) : null),
    [clientDocument],
  );

  function start(next: Action) {
    setAction(next);
    setDialogError(null);
    /* A name already given carries over, so backing out of one answer and
       choosing another does not ask for it twice. */
    setStep(name.trim() ? "details" : "name");
  }

  function close() {
    if (!busy) setAction(null);
  }

  async function submit(next: Action) {
    if (busy) return;
    if (next === "reject" && !reason.trim()) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/amc/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: next,
          name: name.trim(),
          ...(next === "reject" ? { reason: reason.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(body?.error ?? "We could not record your answer.");
        return;
      }
      setDoc(body.data as PublicStatus);
      setAction(null);
    } catch {
      setDialogError("We could not record your answer. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /* A failure is reported by the menu (ClientDownloadMenu). */
  async function download(format: ClientFileFormat) {
    if (!clientDocument) return;
    const { blob, filename } = await buildAmcPdfForClient(clientDocument, format);
    saveAs(blob, filename);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh)] items-center justify-center py-8">
        <Loader />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <EmptyState
          title="We could not load this document"
          description={
            error ??
            "The link may have expired or been replaced. Please reach out to Yalla Fix It so we can send it again."
          }
          icon={<AlertCircle />}
        />
      </main>
    );
  }

  /* Answered — here or on an earlier visit — is final: show the outcome,
     not buttons that would fail. */
  if (doc.status === "signed") {
    return (
      <StatusMessageCard
        title="Contract signed"
        description={`Thank you. Signed by ${doc.signedByName ?? "you"}${
          doc.signedAt ? ` on ${new Date(doc.signedAt).toLocaleDateString("en-GB")}` : ""
        }. Your AMC is now in place and our team will be in touch to schedule the first visit.`}
        icon={<CheckCircle2 size={32} className="text-green-600" />}
        iconBg="bg-green-50"
      />
    );
  }
  if (doc.kind === "proposal" && doc.status !== "proposal_sent") {
    if (doc.status === "proposal_rejected") {
      return (
        <StatusMessageCard
          title="Changes requested"
          description="Thank you. We have passed your comments to the team and will send you a revised proposal."
          icon={<MessageSquareWarning size={32} className="text-amber-600" />}
          iconBg="bg-amber-50"
        />
      );
    }
    return (
      <StatusMessageCard
        title="Proposal approved"
        description="Thank you. Your approval has been recorded, and we will send your contract for signature shortly."
        icon={<CheckCircle2 size={32} className="text-green-600" />}
        iconBg="bg-green-50"
      />
    );
  }
  if (doc.kind === "contract" && doc.status !== "contract_sent") {
    return (
      <StatusMessageCard
        title="Nothing to do right now"
        description="This contract is not awaiting your signature. Our team will be in touch if anything is needed."
        icon={<AlertCircle size={32} className="text-slate-500" />}
        iconBg="bg-slate-100"
      />
    );
  }

  const isContract = doc.kind === "contract";
  const noun = isContract ? "contract" : "proposal";
  const numbered = doc.proposalNumber ? `${noun} ${doc.proposalNumber}` : `this ${noun}`;

  const sentOn = formatClientDate(clientDocument?.sentAt ?? null);
  const period =
    doc.startDate && doc.endDate
      ? `${formatClientDate(doc.startDate)} to ${formatClientDate(doc.endDate)}`
      : null;

  const decisionButtons = (
    <>
      {isContract ? (
        <Button className="flex-1 sm:flex-none" disabled={busy} onClick={() => start("sign")}>
          <FileSignature className="size-4" /> Sign contract
        </Button>
      ) : (
        <>
          <Button
            className="flex-1 sm:flex-none"
            variant="outline"
            disabled={busy}
            onClick={() => start("reject")}
          >
            <MessageSquareWarning className="size-4" /> Request changes
          </Button>
          <Button className="flex-1 sm:flex-none" disabled={busy} onClick={() => start("approve")}>
            <CheckCircle2 className="size-4" /> Approve proposal
          </Button>
        </>
      )}
    </>
  );

  const downloadButton = <ClientDownloadMenu onDownload={download} disabled={!clientDocument} />;

  return (
    <ClientDocumentShell
      actions={
        <>
          {downloadButton}
          {decisionButtons}
        </>
      }
      facts={[
        { label: "Prepared for", value: doc.customerName ?? "—", hint: doc.property?.propertyAddress },
        {
          label: "Annual fee",
          value: formatCurrencyAED(doc.finalPrice),
          hint: [doc.paymentTerms && `Paid ${doc.paymentTerms}`, "excl. 5% VAT"].filter(Boolean).join(" · "),
        },
        {
          label: period ? "Contract period" : "Sent",
          value: period ?? sentOn ?? "—",
          hint: period && sentOn ? `Sent ${sentOn}` : undefined,
        },
      ]}
    >
        <Dialog open={action !== null} onOpenChange={(open) => !open && close()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {step === "name"
                  ? "Who is responding?"
                  : action === "sign"
                    ? `Sign ${numbered}?`
                    : action === "approve"
                      ? `Approve ${numbered}?`
                      : `Request changes to ${numbered}?`}
              </DialogTitle>
              <DialogDescription>
                {step === "name"
                  ? action === "sign"
                    ? "Type your full name. It is recorded as your signature, with the date and time."
                    : "We record this against your answer, so please tell us who you are."
                  : action === "sign"
                    ? "This signs the contract and confirms you accept all of its terms. It is final."
                    : action === "approve"
                      ? "This confirms you accept the proposal. We will then prepare your contract for signature."
                      : "Tell us what should change and we will send you a revised proposal."}
              </DialogDescription>
            </DialogHeader>

            {step === "name" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="amc-client-name">
                  {action === "sign" ? "Full name" : "Your name"}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="amc-client-name"
                  value={name}
                  autoFocus
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && name.trim()) setStep("details");
                  }}
                  placeholder="e.g. Sarah Ahmed"
                />
              </div>
            ) : action === "reject" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="amc-client-reason">
                  What should change? <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="amc-client-reason"
                  value={reason}
                  autoFocus
                  rows={3}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Please tell us what to revise"
                />
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                {action === "sign" ? "Signing" : "Approving"} as{" "}
                <strong className="text-slate-900">{name.trim()}</strong>.
              </p>
            )}

            {dialogError && (
              <p className="text-destructive text-sm" role="alert">
                {dialogError}
              </p>
            )}

            <DialogFooter>
              {step === "name" ? (
                <>
                  <Button variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button disabled={!name.trim()} onClick={() => setStep("details")}>
                    Continue
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => setStep("name")}>
                    Back
                  </Button>
                  {action === "reject" ? (
                    <Button
                      variant="destructive"
                      disabled={busy || !reason.trim()}
                      onClick={() => void submit("reject")}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                      {busy ? "Sending…" : "Send request"}
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={() => action && void submit(action)}>
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : action === "sign" ? (
                        <FileSignature className="size-4" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      {busy
                        ? action === "sign"
                          ? "Signing…"
                          : "Approving…"
                        : action === "sign"
                          ? "Confirm and sign"
                          : "Confirm approval"}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {data ? (
          <AmcDocumentPreview data={data} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            The document could not be shown here. Use Download PDF for a copy.
          </p>
        )}

    </ClientDocumentShell>
  );
}

