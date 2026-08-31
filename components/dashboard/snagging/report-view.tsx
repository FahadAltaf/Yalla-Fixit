"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Download, Printer, Send } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { elementToPdfBlob } from "@/lib/snagging/report-pdf";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { InspectionReport } from "./inspection-report";
import { ErrorState, SubmitButton } from "./shared";

const CHANNELS = [
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "manual", label: "Handed over" },
] as const;

/**
 * The client report screen (K1-K3): loads the inspection, renders the
 * branded report, and lets a coordinator download it as a PDF, print it,
 * or record that it was delivered to the client.
 */
export function ReportView({ taskId }: { taskId: string }) {
  const { userProfile } = useAuth();
  const reportRef = useRef<HTMLDivElement>(null);

  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [quotation, setQuotation] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["key"]>("email");
  const [recipient, setRecipient] = useState("");
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, q] = await Promise.all([
        snaggingService.getTask(taskId),
        snaggingService.getQuotation(taskId).catch(() => null),
      ]);
      setTask(t);
      setQuotation(q);
      setRecipient(t.property?.client_email ?? t.property?.client_phone ?? "");
    } catch (err) {
      // Kept on screen with a retry: a toast that has faded leaves this
      // page reading as "this inspection could not be found", which sends
      // a coordinator hunting for a report that exists.
      setError(err instanceof Error ? err.message : "Could not load the inspection");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canDeliver = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.APPROVE);

  async function downloadPdf() {
    if (!reportRef.current || !task) return;
    setBusy(true);
    // Rasterising a multi-page report takes seconds; the toast holds the
    // place so the download does not land with no explanation.
    const t = toast.loading("Preparing the PDF…");
    try {
      const blob = await elementToPdfBlob(reportRef.current);
      saveAs(blob, `${task.code}-snagging-report.pdf`);
      toast.success("PDF downloaded", { id: t });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the PDF", { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function deliver() {
    if (!recipient.trim()) {
      toast.error("Enter the client email or number the report goes to");
      return;
    }
    setBusy(true);
    try {
      const res = await snaggingService.deliverReport(taskId, {
        channel,
        recipient: recipient.trim(),
      });
      setReportUrl(res.report_url);
      toast.success(res.email_sent ? "Report emailed to the client" : "Report link ready to share");
      setDeliverOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not deliver the report");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!reportUrl) return;
    try {
      await navigator.clipboard.writeText(reportUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-[600px] w-full max-w-[794px]" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load the report"
        message={error}
        onRetry={() => void load()}
        retrying={loading}
      />
    );
  }

  if (!task) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">This inspection could not be found.</p>
      </Card>
    );
  }

  const notReady = ["draft", "assigned", "in_progress"].includes(task.status);

  return (
    <div className="flex flex-col gap-4">
      {/* Print isolation: only the report node is visible on paper. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .snag-report-print, .snag-report-print * { visibility: visible !important; }
        .snag-report-print { position: absolute; left: 0; top: 0; }
        .snag-report-noprint { display: none !important; }
      }`}</style>

      <div className="snag-report-noprint flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/snagging/${taskId}`}>
            <ArrowLeft className="size-4" />
            Back to inspection
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => window.print()} disabled={busy}>
            <Printer className="size-4" />
            Print
          </Button>
          <SubmitButton
            variant="outline"
            onClick={() => void downloadPdf()}
            pending={busy}
            icon={<Download className="size-4" />}
          >
            Download PDF
          </SubmitButton>
          {canDeliver && (task.status === "approved" || task.status === "delivered") ? (
            <Button onClick={() => setDeliverOpen(true)} disabled={busy}>
              <Send className="size-4" />
              {task.status === "delivered" ? "Re-issue link" : "Deliver report"}
            </Button>
          ) : null}
        </div>
      </div>

      {notReady ? (
        <div className="snag-report-noprint border-warning/30 bg-warning/5 rounded-md border px-4 py-2 text-sm">
          This inspection is not finished yet — the report reflects only what has been captured so
          far.
        </div>
      ) : null}
      {task.status === "delivered" ? (
        <div className="snag-report-noprint border-success/30 bg-success/5 flex flex-col gap-2 rounded-md border px-4 py-2 text-sm">
          <div>
            Delivered {task.delivered_at ? new Date(task.delivered_at).toLocaleDateString() : ""}
            {task.delivery_recipient ? ` to ${task.delivery_recipient}` : ""}
            {task.delivery_channel ? ` · ${task.delivery_channel}` : ""}.
          </div>
          {reportUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
                {reportUrl}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                <Copy className="size-3.5" />
                Copy link
              </Button>
            </div>
          ) : (
            <div className="text-muted-foreground text-xs">
              Use “Re-issue link” to generate a fresh client link.
            </div>
          )}
        </div>
      ) : null}

      {/*
        The report itself, on its own white sheet. The sheet is a fixed
        794px (A4 at 96dpi), so it is centred inside the scroller rather
        than left in a wide column with dead space beside it.
      */}
      <div className="overflow-x-auto">
        <div className="snag-report-print mx-auto w-fit rounded-lg border bg-white shadow-sm">
          <InspectionReport ref={reportRef} task={task} quotation={quotation} />
        </div>
      </div>

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deliver report to client</DialogTitle>
            <DialogDescription>
              Generates a private client link and moves the job to delivered. On the email channel
              the client is emailed the moment you confirm — that cannot be taken back. On the other
              channels, copy the link and send it yourself.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Channel</Label>
              <div className="flex gap-2">
                {CHANNELS.map((c) => (
                  <Button
                    key={c.key}
                    type="button"
                    size="sm"
                    variant={channel === c.key ? "default" : "outline"}
                    onClick={() => setChannel(c.key)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recipient">Recipient</Label>
              <Input
                id="recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="client@email.com or +9715xxxxxxx"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void deliver()}
              disabled={recipient.trim().length < 3}
              pending={busy}
              pendingLabel={channel === "email" ? "Emailing…" : "Delivering…"}
              icon={<Send className="size-4" />}
            >
              {channel === "email" ? "Email the report now" : "Confirm delivery"}
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
