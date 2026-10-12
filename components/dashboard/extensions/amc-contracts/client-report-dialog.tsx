"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { insightsService, type ClientReportSendResult } from "@/modules/amc-contracts/insights-service";

import { PreparedMessage, errorText } from "./call-out-shared";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends a contract's client report (Phase 12: DEV-410): the server stores
 * the PDF on the contract, emails it to the client with the account
 * manager copied, and prepares a WhatsApp message with a link. The email
 * is prefilled from the client's contact as signed and may be changed or
 * left empty (the server then uses the email on file). After sending, the
 * dialog shows the WhatsApp message to send from the phone.
 */
export function SendClientReportDialog({
  open,
  onOpenChange,
  contractId,
  contractLabel,
  customerName,
  defaultEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractLabel: string;
  customerName: string;
  defaultEmail: string | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClientReportSendResult | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail ?? "");
      setError(null);
      setResult(null);
    }
  }, [open, defaultEmail]);

  const to = email.trim();
  const valid = !to || EMAIL.test(to);

  const send = async () => {
    if (!valid) {
      setError("Enter a valid email address, or leave it empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sent = await insightsService.sendClientReport(contractId, to || null);
      if (sent.outcome === "sent") toast.success("Client report emailed to the client");
      else if (sent.outcome === "no_recipient") toast.warning("The client has no email address on file: send the report by WhatsApp.");
      else toast.error("The client report email could not be sent. Try again, or send it by WhatsApp.");
      setResult(sent);
    } catch (e) {
      toast.error(errorText(e, "Could not send the client report."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? "Client report prepared" : "Send the client report"}</DialogTitle>
          <DialogDescription>
            {result
              ? result.outcome === "sent"
                ? `Emailed for ${contractLabel}, and kept with the contract's documents.`
                : `Kept with ${contractLabel}'s documents. Send it to ${customerName || "the client"} by WhatsApp.`
              : `The visits, call outs, additional work and allowances on ${contractLabel}, as of today, emailed as a PDF to ${customerName || "the client"}. The account manager is copied.`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          result.message ? (
            <PreparedMessage message={result.message} whatsapp={result.whatsapp} />
          ) : null
        ) : (
          <div className="grid gap-2 py-1">
            <Label htmlFor="amc-client-report-to">Client email (optional)</Label>
            <Input
              id="amc-client-report-to"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="Uses the email on file when empty"
              value={email}
              maxLength={200}
              aria-invalid={!valid}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
            />
            <p className="text-muted-foreground text-xs">Change it to send to someone else at the client. Nothing on the contract is changed.</p>
            {error ? (
              <p className="text-danger text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" asChild>
                <a href={insightsService.clientReportHref(contractId)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Preview
                </a>
              </Button>
              <SubmitButton onClick={() => void send()} disabled={!valid} pending={busy} pendingLabel="Sending…" icon={<Send className="size-4" />}>
                Send to client
              </SubmitButton>
            </>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
