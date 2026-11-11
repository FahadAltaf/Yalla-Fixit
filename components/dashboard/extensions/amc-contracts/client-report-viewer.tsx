"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ClientReport } from "@/lib/server/amc/client-report";
import { insightsService } from "@/modules/amc-contracts/insights-service";

import { AmcDocumentContinuous } from "../amc/templates/amc-doc/AmcDocumentLayouts";
import { buildClientReportModel } from "./client-report-document";
import { useAmcData } from "./use-amc-data";

/** The report as a PDF built in the browser from the same document the viewer shows (live servers have no Chrome to print with). */
export async function clientReportPdf(report: ClientReport): Promise<Blob> {
  const { generateBrandedPdfBlob } = await import("../amc/amc-pdf-utils");
  return generateBrandedPdfBlob(buildClientReportModel(report), { cover: false });
}

export const clientReportFileName = (report: ClientReport) => `AMC service report ${report.contract.number} ${report.asOf}.pdf`;

/**
 * The client report on screen, as the proposal and the contract are shown:
 * the branded document exactly as the client receives it, with Download PDF
 * and Send to client.
 */
export function ClientReportViewer({
  open,
  onOpenChange,
  contractId,
  title,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  title: string;
  /** Opens the send dialog; absent for someone who cannot send. */
  onSend?: () => void;
}) {
  const { data, error, reload } = useAmcData(() => (open ? insightsService.clientReport(contractId) : Promise.resolve(null)), open ? `report|${contractId}` : "closed");
  const report = data?.report ?? null;
  const model = useMemo(() => (report ? buildClientReportModel(report) : null), [report]);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const blob = await clientReportPdf(report);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = clientReportFileName(report);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("Client report downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={downloading} showCloseButton={false} className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex-col gap-3 border-b px-6 py-4 text-left sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription>The service report exactly as the client receives it, as of today.</DialogDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void download()} disabled={!report || downloading}>
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {downloading ? "Building PDF…" : "Download PDF"}
            </Button>
            {onSend ? (
              <Button type="button" size="sm" onClick={onSend} disabled={!report || downloading}>
                <Send className="size-4" />
                Send to client
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={downloading}>
                <X className="size-4" />
                Close
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="bg-muted/50 min-h-0 flex-1 overflow-auto">
          <div className="flex items-start justify-center p-6">
            {error ? (
              <div className="w-full max-w-lg">
                <ErrorState title="Could not build the client report" message={error} onRetry={reload} />
              </div>
            ) : model ? (
              <div className="overflow-hidden rounded bg-white shadow-lg ring-1 ring-black/5">
                <AmcDocumentContinuous model={model} cover={false} />
              </div>
            ) : (
              <div className="w-[794px] max-w-full space-y-4 rounded bg-white p-10 shadow-lg" aria-label="Loading the client report">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
          </div>
        </div>
      </ActionDialogContent>
    </Dialog>
  );
}
