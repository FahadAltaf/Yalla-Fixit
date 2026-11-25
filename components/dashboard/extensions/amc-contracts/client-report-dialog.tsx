"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { insightsService } from "@/modules/amc-contracts/insights-service";

import { clientReportFileName, clientReportPdf } from "./client-report-viewer";
import { SendDialog } from "./send-options";

/* A Blob as base64, for the JSON body. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends a contract's client report (Phase 12: DEV-410): the server stores
 * the PDF on the contract, then it goes by WhatsApp, email (the account
 * manager copied) or as a link to copy -- the same three ways as every send
 * (17 Nov 2026). For email the address is prefilled from the client's
 * contact and may be changed or left empty (the email on file is used).
 */
export function SendClientReportDialog({
  open,
  onOpenChange,
  contractId,
  contractLabel,
  customerName,
  defaultEmail,
  onPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractLabel: string;
  customerName: string;
  defaultEmail: string | null;
  /** Opens the report in the viewer. */
  onPreview?: () => void;
}) {
  /* null: not changed, so the client's email as on file. */
  const [typed, setTyped] = useState<string | null>(null);
  const [financials, setFinancials] = useState(true);
  const email = typed ?? defaultEmail ?? "";
  const to = email.trim();
  const valid = !to || EMAIL.test(to);

  return (
    <SendDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped(null);
        onOpenChange(next);
      }}
      title="Send the client report"
      description={`The visits, call outs, additional work and allowances on ${contractLabel}, as of today, for ${customerName || "the client"}. A copy is kept with the contract's documents.`}
      what="the client report"
      noun="Client report"
      canSend={(channel) => channel !== "email" || valid}
      /* WhatsApp carries no link (18 Nov 2026): the PDF is downloaded and attached. */
      download={async () => {
        const { report } = await insightsService.clientReport(contractId, financials);
        const blob = await clientReportPdf(report);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = clientReportFileName(report);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }}
      onSend={async (channel) => {
        /* The branded PDF, as the viewer shows it; if it cannot be built here the server prints its own. */
        const pdf = await insightsService
          .clientReport(contractId, financials)
          .then(({ report }) => clientReportPdf(report))
          .then(toBase64)
          .catch(() => null);
        return insightsService.sendClientReport(contractId, channel === "email" ? to || null : null, pdf, channel, financials);
      }}
    >
      {(channel) => (
        <>
          {/* DEV-503: the version without financial figures. */}
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
            <span>
              <span className="font-medium">Include prices</span>
              <span className="text-muted-foreground block text-xs">Off: the visits and call outs with their dates, without any amounts or additional work costs.</span>
            </span>
            <Switch checked={financials} onCheckedChange={setFinancials} aria-label="Include prices in the report" />
          </label>
          {channel === "email" ? (
            <div className="grid gap-1.5">
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
                onChange={(event) => setTyped(event.target.value)}
              />
              <p className={valid ? "text-muted-foreground text-xs" : "text-danger text-xs"}>
                {valid ? "Change it to send to someone else at the client. The account manager is copied." : "Enter a valid email address, or leave it empty."}
              </p>
            </div>
          ) : null}
          {onPreview ? (
            <Button variant="outline" size="sm" className="w-fit" onClick={onPreview}>
              <Eye className="size-4" />
              View report
            </Button>
          ) : null}
        </>
      )}
    </SendDialog>
  );
}
