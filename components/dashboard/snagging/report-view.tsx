"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FileType,
  Loader2,
  Printer,
  Send,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { InspectionReport } from "./inspection-report";
import { ActionDialogContent, ErrorState, SubmitButton } from "./shared";
import { ReportSkeleton } from "@/components/dashboard/snagging/route-skeletons";

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

  /*
    Name this page in the breadcrumb.

    The trail is built from the URL, so without this the crumb was the job's
    UUID title-cased into "B32c501d 1ac5 42e6 A208 …" — a raw id sitting
    exactly where the unit's name belongs. The job detail page already does
    this; the report page was simply missed.
  */
  useBreadcrumbLabel(taskId, task?.property?.unit_label ?? undefined);
  const [quotation, setQuotation] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [channel, setChannel] =
    useState<(typeof CHANNELS)[number]["key"]>("email");
  const [recipient, setRecipient] = useState("");
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, q] = await Promise.all([
        // Everything the report prints; not the de-snag quotation.
        snaggingService.getTask(taskId, {}, ["snags", "checklist", "floor_plans", "visit_status"]),
        snaggingService.getQuotation(taskId).catch(() => null),
      ]);
      setTask(approvedOnly(t));
      setQuotation(q);
      setRecipient(t.property?.client_email ?? t.property?.client_phone ?? "");
    } catch (err) {
      // Kept on screen with a retry: a toast that has faded leaves this
      // page reading as "this inspection could not be found", which sends
      // a coordinator hunting for a report that exists.
      setError(
        err instanceof Error ? err.message : "Could not load the inspection",
      );
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Delivering runs through the same guard as approving: only this job's
    named approval manager, or an admin. Following the permission alone
    would offer a button the server answers with a 403.
  */
  const canDeliver =
    hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.APPROVE) &&
    (isAdminUser(userProfile) ||
      Boolean(
        task?.approval_manager_id &&
        userProfile?.id === task.approval_manager_id,
      ));

  async function download(format: "pdf" | "docx") {
    if (!task) return;
    setBusy(true);
    // Rasterising a multi-page report takes seconds; the toast holds the
    // place so the download does not land with no explanation.
    const t = toast.loading(
      format === "pdf" ? "Preparing the PDF…" : "Preparing the Word file…",
    );
    try {
      /*
        The PDF is the report rendered fresh with forPDF and rasterised;
        the Word file is the same content built as a document, so its text
        stays text.
      */
      // The PDF and Word builders (html2canvas, jsPDF, docx) load on the
      // first download, not with the page.
      const builders = await import("./report-pdf-download");
      const { blob, filename } =
        format === "pdf"
          ? await builders.buildInspectionReportPdf(task, quotation)
          : await builders.buildInspectionReportDocx(task, quotation);
      saveAs(blob, filename);
      toast.success(
        format === "pdf" ? "PDF downloaded" : "Word file downloaded",
        { id: t },
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not build the document",
        { id: t },
      );
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
      const whatsappUrl = res.whatsapp_url;
      if (whatsappUrl) {
        /*
          The message is written; WhatsApp still has to be opened to send
          it. A button in the toast rather than opening it here: a window
          opened after a request returns is blocked as a pop-up.
        */
        toast.success("Report link ready to send", {
          description: "Open WhatsApp to send the client the message.",
          action: {
            label: "Open WhatsApp",
            onClick: () => window.open(whatsappUrl, "_blank", "noopener,noreferrer"),
          },
          duration: 15000,
        });
      } else {
        toast.success(
          res.email_sent
            ? "Report emailed to the client"
            : "Report link ready to share",
        );
      }
      setDeliverOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not deliver the report",
      );
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

  // Shaped like the report, and the same placeholder the route shows.
  if (loading) return <ReportSkeleton />;

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
        <p className="text-muted-foreground">
          This inspection could not be found.
        </p>
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
          <Button
            variant="outline"
            onClick={() => window.print()}
            disabled={busy}
          >
            <Printer className="size-4" />
            Print
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Download
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void download("pdf")}>
                <FileText className="size-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void download("docx")}>
                <FileType className="size-4" />
                Word (.docx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canDeliver &&
          (task.status === "approved" || task.status === "delivered") ? (
            <Button onClick={() => setDeliverOpen(true)} disabled={busy}>
              <Send className="size-4" />
              {task.status === "delivered" ? "Re-issue link" : "Deliver report"}
            </Button>
          ) : null}
        </div>
      </div>

      {notReady ? (
        <div className="snag-report-noprint border-warning/30 bg-warning/5 rounded-md border px-4 py-2 text-sm">
          This inspection is not finished yet. The report reflects only what has
          been captured so far.
        </div>
      ) : null}
      {task.status === "delivered" ? (
        <div className="snag-report-noprint border-success/30 bg-success/5 flex flex-col gap-2 rounded-md border px-4 py-2 text-sm">
          <div>
            Delivered{" "}
            {task.delivered_at
              ? new Date(task.delivered_at).toLocaleDateString()
              : ""}
            {task.delivery_recipient ? ` to ${task.delivery_recipient}` : ""}
            {task.delivery_channel ? ` · ${task.delivery_channel}` : ""}.
          </div>
          {reportUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
                {reportUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyLink()}
              >
                <Copy className="size-3.5" />
                Copy link
              </Button>
            </div>
          ) : (
            <div className="text-muted-foreground text-xs">
              Use &quot;Re-issue link&quot; to generate a fresh client link.
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
        <ActionDialogContent busy={busy}>
          <DialogHeader>
            <DialogTitle>Deliver report to client</DialogTitle>
            <DialogDescription>
              Generates a private client link and moves the job to delivered. On
              the email channel the client is emailed the moment you confirm,
              and that cannot be taken back. On the other channels, copy the
              link and send it yourself.
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
            <Button
              variant="outline"
              onClick={() => setDeliverOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void deliver()}
              disabled={recipient.trim().length < 3}
              pending={busy}
              pendingLabel={channel === "email" ? "Emailing…" : "Delivering…"}
              icon={<Send className="size-4" />}
            >
              {channel === "email"
                ? "Email the report now"
                : "Confirm delivery"}
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The job as the client's report may show it: without anything recorded
 * by a visit the manager has not approved.
 *
 * A submitted visit's snags, the room it added and its checklist answers
 * went straight into this preview -- and into the PDF downloaded from it
 * -- before anybody had reviewed them. The server-built report applies the
 * same rule (report-data.ts), so the preview and the delivered document
 * agree.
 */
function approvedOnly(task: SnaggingTask): SnaggingTask {
  const pending = new Set(task.unapproved_visit_ids ?? []);
  if (pending.size === 0) return task;
  const unapproved = (visitId?: string | null) =>
    Boolean(visitId && pending.has(visitId));
  return {
    ...task,
    snags: (task.snags ?? []).filter((snag) => !unapproved(snag.visit_id)),
    areas: (task.areas ?? []).filter((area) => !unapproved(area.visit_id)),
    // A visit answers an item the walk could not; until it is approved the
    // report says what the walk did -- not checked.
    checklist: (task.checklist ?? []).map((item) =>
      unapproved(item.visit_id)
        ? { ...item, status: "not_checked", reason: null }
        : item,
    ),
  };
}
