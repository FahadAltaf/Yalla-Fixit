"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { buildServiceReportModel, serviceReportFileName, serviceReportTitle, type ServiceReportFacts } from "@/lib/amc/service-report";

import { AmcDocumentContinuous } from "../amc/templates/amc-doc/AmcDocumentLayouts";
import { useAmcData } from "./use-amc-data";

/** The report as a PDF built in the browser from the same document the viewer shows (live servers have no Chrome). */
export async function serviceReportPdf(facts: ServiceReportFacts): Promise<Blob> {
  const { generateBrandedPdfBlob } = await import("../amc/amc-pdf-utils");
  return generateBrandedPdfBlob(buildServiceReportModel(facts), { cover: false });
}

/** A Blob as base64, for a JSON body. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * The report's PDF for a send (close, resend): built here so the client gets
 * the branded document; null when it cannot be built, and the server prints
 * its own.
 */
export async function serviceReportPdfBase64(loadFacts: () => Promise<{ facts: ServiceReportFacts }>): Promise<string | null> {
  try {
    const { facts } = await loadFacts();
    return await blobToBase64(await serviceReportPdf(facts));
  } catch {
    return null;
  }
}

/** Builds and saves the report's PDF, with a toast while it builds. */
export async function downloadServiceReport(loadFacts: () => Promise<{ facts: ServiceReportFacts }>) {
  const id = toast.loading("Preparing the service report (PDF)…");
  try {
    const { facts } = await loadFacts();
    const name = serviceReportFileName(facts);
    saveBlob(await serviceReportPdf(facts), name);
    toast.success(`Downloaded ${name}`, { id });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not build the PDF.", { id });
  }
}

/**
 * The service report on screen, as the proposal, the contract and the client
 * report are shown (18 Nov 2026): the branded document exactly as the client
 * receives it, with Download PDF and Send to client.
 */
export function ServiceReportViewer({
  open,
  onOpenChange,
  loadFacts,
  cacheKey,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadFacts: () => Promise<{ facts: ServiceReportFacts }>;
  /** Changes when the report should be read again (the record's id). */
  cacheKey: string;
  /** Opens the send dialog; absent for someone who cannot send. */
  onSend?: () => void;
}) {
  const { data, error, reload } = useAmcData(() => (open ? loadFacts() : Promise.resolve(null)), open ? `service-report|${cacheKey}` : "closed");
  const facts = data?.facts ?? null;
  const model = useMemo(() => (facts ? buildServiceReportModel(facts) : null), [facts]);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!facts) return;
    setDownloading(true);
    try {
      const name = serviceReportFileName(facts);
      saveBlob(await serviceReportPdf(facts), name);
      toast.success(`Downloaded ${name}`);
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
            <DialogTitle className="text-lg">{facts ? serviceReportTitle(facts) : "Service report"}</DialogTitle>
            <DialogDescription>The service report exactly as the client receives it.</DialogDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void download()} disabled={!facts || downloading}>
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {downloading ? "Building PDF…" : "Download PDF"}
            </Button>
            {onSend ? (
              <Button type="button" size="sm" onClick={onSend} disabled={!facts || downloading}>
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
                <ErrorState title="Could not build the service report" message={error} onRetry={reload} />
              </div>
            ) : model ? (
              <div className="overflow-hidden rounded bg-white shadow-lg ring-1 ring-black/5">
                <AmcDocumentContinuous model={model} cover={false} />
              </div>
            ) : (
              <div className="bg-card w-[794px] max-w-full space-y-4 rounded border p-10 shadow-lg" aria-label="Loading the service report">
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
