"use client";

import { useCallback, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Attachment, ServiceAppointment } from "@/types/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Search, Download, FileArchive, CheckCircle2,
  AlertCircle, Paperclip, XCircle, FolderArchive, Briefcase,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SEARCH_ENDPOINT =
  "https://primary-production-6170.up.railway.app/webhook/a62d1e0d-1808-48cc-a3f7-754c02d8d10b";

const CONCURRENT_DOWNLOADS = 6;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type DownloadStatus = "idle" | "downloading" | "zipping" | "finished" | "error";

interface DownloadState {
  status:       DownloadStatus;
  completed:    number;
  failed:       number;
  total:        number;
  currentFiles: string[];
}

// Shape returned by edge function / bulk-download route
interface WOAppointment {
  id:          string;
  name:        string;
  attachments: Attachment[];
}

interface WorkOrderInfo {
  id:                 string;
  name:               string;
  status:             string;
  summary:            string;
  contact_name:       string;
  type:               string;
  address:            string;
  total_appointments: number;
  total_attachments:  number;
  appointments:       WOAppointment[];
}

const initialDownloadState: DownloadState = {
  status: "idle", completed: 0, failed: 0, total: 0, currentFiles: [],
};

// ─── SEMAPHORE ────────────────────────────────────────────────────────────────

function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () => new Promise<void>((resolve) => {
    if (active < limit) { active++; resolve(); }
    else { queue.push(() => { active++; resolve(); }); }
  });
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return { acquire, release };
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export function ExtensionsPageClient() {

  // ── By Appointment state ──
  const [query, setQuery]             = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [appointment, setAppointment] = useState<ServiceAppointment | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── By Work Order state ──
  const [woQuery, setWoQuery]               = useState("");
  const [isWoSearching, setIsWoSearching]   = useState(false);
  const [workOrderInfo, setWorkOrderInfo]   = useState<WorkOrderInfo | null>(null);
  const [woSearchError, setWoSearchError]   = useState<string | null>(null);

  // ── Shared download dialog state ──
  const [downloadState, setDownloadState] = useState<DownloadState>(initialDownloadState);
  const [isDialogOpen, setIsDialogOpen]   = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmContext, setConfirmContext] = useState<"appointment" | "workorder" | null>(null);

  const { settings } = useAuth();

  const isDownloading = downloadState.status === "downloading" || downloadState.status === "zipping";

  const progressValue = downloadState.total > 0
    ? ((downloadState.completed + downloadState.failed) / downloadState.total) * 100
    : 0;

  // ── Single appointment status badge ──
  const statusVariant = useMemo(() => {
    if (!appointment?.status) return "default" as const;
    const n = appointment.status.toLowerCase();
    if (n === "completed")   return "success" as const;
    if (n === "in progress") return "warning" as const;
    return "destructive" as const;
  }, [appointment?.status]);

  // ── WO status badge ──
  const woStatusVariant = useMemo(() => {
    if (!workOrderInfo?.status) return "default" as const;
    const n = workOrderInfo.status.toLowerCase();
    if (n === "completed")   return "default" as const;
    if (n === "in progress") return "outline" as const;
    return "destructive" as const;
  }, [workOrderInfo?.status]);

  // ─── Core download engine (reused for both tabs) ───────────────────────────
  // files: flat array of { attachment, folderName }
  // zipName: final zip filename

  const runDownload = useCallback(async (
    files: { attachment: Attachment; folder: string }[],
    zipName: string
  ) => {
    setDownloadState({ status: "downloading", completed: 0, failed: 0, total: files.length, currentFiles: [] });
    setIsDialogOpen(true);

    const semaphore  = createSemaphore(CONCURRENT_DOWNLOADS);
    let   successCount = 0;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      const JSZip = (await import("jszip")).default;
      const zip   = new JSZip();

      // Track used names per folder to avoid duplicates
      const usedNames = new Map<string, Map<string, number>>();
      const getUniqueName = (folder: string, raw: string): string => {
        if (!usedNames.has(folder)) usedNames.set(folder, new Map());
        const folderMap = usedNames.get(folder)!;
        const count     = folderMap.get(raw) ?? 0;
        folderMap.set(raw, count + 1);
        if (count === 0) return raw;
        const dot  = raw.lastIndexOf(".");
        const base = dot === -1 ? raw : raw.slice(0, dot);
        const ext  = dot === -1 ? "" : raw.slice(dot);
        return `${base} (${count + 1})${ext}`;
      };

      const fetchWithRetry = async (url: string): Promise<ArrayBuffer> => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.arrayBuffer();
          } catch (e) {
            lastError = e;
            if (attempt < 3) await delay(500 * attempt);
          }
        }
        throw lastError;
      };

      await Promise.all(
        files.map(async ({ attachment, folder }) => {
          await semaphore.acquire();

          const rawName  = attachment.File_Name || `attachment_${attachment?.$file_id}`;
          const fileName = getUniqueName(folder, rawName);
          // Full path in ZIP: "folder/fileName" or just "fileName" if no folder
          const zipPath  = folder ? `${folder}/${fileName}` : fileName;

          setDownloadState((p) => ({
            ...p,
            currentFiles: [...p.currentFiles.slice(-4), fileName],
          }));

          try {
            const fileId = attachment["$file_id"];
            const url    = `/api/zoho-file?file_id=${encodeURIComponent(fileId)}&token=${settings?.oauth_access_token}`;
            const buffer = await fetchWithRetry(url);
            zip.file(zipPath, buffer);
            successCount++;
            setDownloadState((p) => ({ ...p, completed: p.completed + 1 }));
          } catch {
            setDownloadState((p) => ({ ...p, failed: p.failed + 1 }));
          } finally {
            semaphore.release();
          }
        })
      );

      if (successCount === 0) {
        setDownloadState((p) => ({ ...p, status: "error" }));
        toast.error("Failed to download any files. Please try again.");
        return;
      }

      setDownloadState((p) => ({ ...p, status: "zipping" }));
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, zipName);

      setDownloadState((p) => ({
        ...p,
        status: "finished",
        completed: successCount,
        currentFiles: [],
      }));

      const total = files.length;
      const failed = total - successCount;
      if (failed > 0) {
        toast.warning(`Downloaded ${successCount} of ${total} files. ${failed} failed.`);
      } else {
        toast.success(`All ${successCount} files downloaded successfully!`);
      }

    } catch {
      setDownloadState((p) => ({ ...p, status: "error" }));
      toast.error("Download failed. Please try again.");
    }
  }, [settings]);

  // ─── By Appointment: Search ────────────────────────────────────────────────

  const handleApptSearch = useCallback(async (value?: string) => {
    const name = (value ?? query).trim();
    if (!name) { toast.error("Please enter a service appointment name."); return; }

    setIsSearching(true);
    setSearchError(null);
    setAppointment(null);

    try {
      const res  = await fetch(SEARCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = (await res.json()) as ServiceAppointment | null;
      if (!data?.id) { setSearchError("No appointment found."); return; }
      setAppointment(data);
    } catch {
      setSearchError("No appointment found. Please check the name and try again.");
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  // ─── By Appointment: Download ──────────────────────────────────────────────

  const handleApptDownload = useCallback(async () => {
    if (!appointment?.attachments?.length) return;

    const files = appointment.attachments.map((att) => ({
      attachment: att,
      folder: "", // flat zip, no subfolders for single appointment
    }));

    await runDownload(files, `${appointment.name}_attachments.zip`);
  }, [appointment, runDownload]);

  // ─── By Work Order: Search ─────────────────────────────────────────────────

  const handleWoSearch = useCallback(async (value?: string) => {
    const name = (value ?? woQuery).trim();
    if (!name) { toast.error("Please enter a work order name."); return; }

    setIsWoSearching(true);
    setWoSearchError(null);
    setWorkOrderInfo(null);

    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, comparator: "equal" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setWoSearchError(data.error ?? "Work order not found.");
        return;
      }

      setWorkOrderInfo(data as WorkOrderInfo);
    } catch {
      setWoSearchError("Failed to fetch work order. Please try again.");
    } finally {
      setIsWoSearching(false);
    }
  }, [woQuery]);

  // ─── By Work Order: Download all files ────────────────────────────────────

  const handleWoBulkDownload = useCallback(async () => {
    if (!workOrderInfo?.appointments?.length) return;

    // Flatten all appointments → files, use appointment name as folder
    const files = workOrderInfo.appointments.flatMap((appt) =>
      appt.attachments.map((att) => ({
        attachment: att,
        folder: appt.name,   // e.g. "AP-856" becomes a folder in the ZIP
      }))
    );

    if (files.length === 0) {
      toast.error("No attachments found in any appointment.");
      return;
    }

    await runDownload(files, `${workOrderInfo.name}_WorkOrder_Attachments.zip`);
  }, [workOrderInfo, runDownload]);

  // ─── Dialog close ──────────────────────────────────────────────────────────

  const handleCloseDialog = () => {
    if (isDownloading) return;
    setIsDialogOpen(false);
    setTimeout(() => setDownloadState(initialDownloadState), 300);
  };

  const handleConfirmDownload = async () => {
    if (confirmContext === "appointment") {
      await handleApptDownload();
    } else if (confirmContext === "workorder") {
      await handleWoBulkDownload();
    }
    setIsConfirmOpen(false);
    setConfirmContext(null);
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <>
      <ConfirmationAlertDialog
        isOpen={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Work Is Still In Progress"
        description={
          confirmContext === "appointment"
            ? "This service appointment is still In Progress. Attachments may be incomplete. Do you still want to download the current files?"
            : "This work order is still In Progress. Attachments across its appointments may be incomplete. Do you still want to download the current files?"
        }
        confirmText="Continue download"
        cancelText="Cancel"
        onConfirm={handleConfirmDownload}
        // icon={<AlertCircle className="text-amber-500" />}
      />
      {/* ── Download Progress Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => isDownloading && e.preventDefault()}
          onEscapeKeyDown={(e) => isDownloading && e.preventDefault()}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileArchive className="size-5 text-primary" />
              {downloadState.status === "finished"  ? "Download Complete"
               : downloadState.status === "error"   ? "Download Failed"
               : downloadState.status === "zipping" ? "Creating ZIP"
               : "Downloading Files"}
            </DialogTitle>
            <DialogDescription>
              {downloadState.status === "downloading" && `Downloading ${downloadState.total} file(s) with ${CONCURRENT_DOWNLOADS} parallel threads`}
              {downloadState.status === "zipping"     && "Compressing all files into a ZIP archive…"}
              {downloadState.status === "finished"    && `Successfully packaged ${downloadState.completed} file${downloadState.completed === 1 ? "" : "s"}`}
              {downloadState.status === "error"       && "Something went wrong during the download."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex justify-center">

              {downloadState.status === "finished" && (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="size-14 text-green-500 animate-in zoom-in-50 duration-300" />
                  <p className="text-sm text-muted-foreground">Your ZIP file is saving…</p>
                </div>
              )}

              {downloadState.status === "error" && (
                <XCircle className="size-14 text-destructive animate-in zoom-in-50 duration-300" />
              )}

              {(downloadState.status === "downloading" || downloadState.status === "zipping") && (
                <div className="w-full space-y-3">
                  <Progress
                    value={downloadState.status === "zipping" ? 100 : progressValue}
                    className="h-2.5"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {downloadState.status === "zipping"
                        ? "Zipping…"
                        : `${downloadState.completed + downloadState.failed} / ${downloadState.total} processed`}
                    </span>
                    <span className="flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" />
                      {downloadState.status === "zipping" ? "Compressing" : `${Math.round(progressValue)}%`}
                    </span>
                  </div>

                  {downloadState.currentFiles.length > 0 && downloadState.status === "downloading" && (
                    <div className="rounded-md bg-muted/50 p-2 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Active downloads:</p>
                      {downloadState.currentFiles.slice(-3).map((f, i) => (
                        <p key={i} className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                          <Loader2 className="size-3 animate-spin shrink-0" /> {f}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {(downloadState.status === "finished" || downloadState.status === "error") && (
              <Button className="w-full" onClick={handleCloseDialog}>
                {downloadState.status === "finished" ? "Done" : "Close"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Main Card ── */}
      <Card className="w-full flex-1 relative top-px right-px gap-4">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex gap-1 flex-col">
            <CardTitle className="text-xl flex items-center gap-2">
              <Download className="size-5 text-primary" />
              Bulk Download
            </CardTitle>
            <CardDescription>
              Download all attachments for a service appointment or an entire work order.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="appointment" className="w-full gap-0">
            <TabsList className="mb-4 w-full sm:w-auto">
              <TabsTrigger value="appointment" className="flex items-center gap-2">
                <Paperclip className="size-4" />
                By Appointment
              </TabsTrigger>
              <TabsTrigger value="workorder" className="flex items-center gap-2">
                <FolderArchive className="size-4" />
                By Work Order
              </TabsTrigger>
            </TabsList>

            {/* ══════════════════════════════════════════════
                TAB 1 — By Appointment (existing logic)
            ══════════════════════════════════════════════ */}
            <TabsContent value="appointment" className="space-y-5 mt-0">
              <form
                onSubmit={(e) => { e.preventDefault(); void handleApptSearch(); }}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="e.g. AP-856"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={isSearching}
                      className="pl-9"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full sm:w-auto min-w-[110px]" disabled={isSearching}>
                  {isSearching
                    ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Searching…</span>
                    : <span className="flex items-center gap-2"><Search className="size-4" />Search</span>}
                </Button>
              </form>

              {searchError && (
                <EmptyState
                  title="Appointment not found"
                  description="The appointment you are looking for does not exist. Please check the name and try again."
                  icon={<AlertCircle />}
                />
              )}

              {isSearching && (
                <Card className="border-dashed">
                  <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
                  <CardContent className="space-y-4">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-4 w-full max-w-sm" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {!appointment && !searchError && !isSearching && (
                <EmptyState
                  title="Search for an appointment"
                  description="Enter the name of the appointment you are looking for and click search."
                  icon={<Search />}
                />
              )}

              {appointment && !isSearching && (
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Briefcase className="size-4 text-primary" />
                        Appointment Details
                      </CardTitle>                      <Badge
                        variant={statusVariant === "success" ? "default" : statusVariant === "warning" ? "outline" : "destructive"}
                        className="capitalize"
                      >
                        {appointment.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                      <FieldRow label="ID"           value={appointment.id} />
                      <FieldRow label="Name"         value={appointment.name} />
                      <FieldRow label="Contact Name" value={appointment.contact_name} />
                      <FieldRow label="Type"         value={appointment.type} />
                      <FieldRow label="Address"      value={appointment.address} />
                      <FieldRow label="Summary"      value={appointment.summary} />
                    </div>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Paperclip className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Attachments</span>
                        </div>
                        {appointment.attachments?.length ? (
                          <Badge variant="secondary">
                            {appointment.attachments.length} file{appointment.attachments.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>
                      {!appointment.attachments?.length ? (
                        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center gap-2">
                          <Paperclip className="size-8 text-muted-foreground/50" />
                          <p className="text-sm text-muted-foreground">No attachments available.</p>
                        </div>
                      ) : (
                        <Button
                          onClick={() => {
                            if (appointment.status?.toLowerCase() === "in progress") {
                              setConfirmContext("appointment");
                              setIsConfirmOpen(true);
                            } else {
                              void handleApptDownload();
                            }
                          }}
                          disabled={isDownloading}
                          className="w-full sm:w-auto gap-2"
                        >
                          <Download className="size-4" />
                          Download All ({appointment.attachments.length} files)
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ══════════════════════════════════════════════
                TAB 2 — By Work Order
            ══════════════════════════════════════════════ */}
            <TabsContent value="workorder" className="space-y-5 mt-0">
              <form
                onSubmit={(e) => { e.preventDefault(); void handleWoSearch(); }}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="e.g. WO731"
                      value={woQuery}
                      onChange={(e) => setWoQuery(e.target.value)}
                      disabled={isWoSearching}
                      className="pl-9"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full sm:w-auto min-w-[110px]" disabled={isWoSearching}>
                  {isWoSearching
                    ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Searching…</span>
                    : <span className="flex items-center gap-2"><Search className="size-4" />Search</span>}
                </Button>
              </form>

              {woSearchError && (
                <EmptyState
                  title="Work order not found"
                  description={woSearchError}
                  icon={<AlertCircle />}
                />
              )}

              {isWoSearching && (
                <Card className="border-dashed">
                  <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
                  <CardContent className="space-y-4">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-4 w-full max-w-sm" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {!workOrderInfo && !woSearchError && !isWoSearching && (
                <EmptyState
                  title="Search for a work order"
                  description="Enter the work order name above and click Search to load its appointments and attachments."
                  icon={<FolderArchive />}
                />
              )}

              {/* ── Work Order Info Card (shown after search) ── */}
              {workOrderInfo && !isWoSearching && (
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Briefcase className="size-4 text-primary" />
                        Work Order Details
                      </CardTitle>
                      <Badge variant={woStatusVariant} className="capitalize">
                        {workOrderInfo.status}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-5">
                    {/* WO fields */}
                    {/* <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                      <FieldRow label="ID"      value={workOrderInfo.id} />
                      <FieldRow label="Name"    value={workOrderInfo.name} />
                      <FieldRow label="Status"  value={workOrderInfo.status} />
                      <FieldRow label="Summary" value={workOrderInfo.summary} />
                    </div> */}
                       <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                      <FieldRow label="ID"           value={workOrderInfo.id} />
                      <FieldRow label="Name"         value={workOrderInfo.name} />
                      <FieldRow label="Contact Name" value={workOrderInfo.contact_name} />
                      <FieldRow label="Type"         value={workOrderInfo.type} />
                      <FieldRow label="Address"      value={workOrderInfo.address} />
                      <FieldRow label="Summary"      value={workOrderInfo.summary} />
                    </div>

                    <Separator />

                    {/* Appointments breakdown */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FolderArchive className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Appointments</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {workOrderInfo.total_appointments} appointment{workOrderInfo.total_appointments === 1 ? "" : "s"}
                          </Badge>
                          <Badge variant="outline">
                            {workOrderInfo.total_attachments} file{workOrderInfo.total_attachments === 1 ? "" : "s"}
                          </Badge>
                        </div>
                      </div>

                      {/* Per-appointment rows */}
                      {workOrderInfo.appointments.length > 0 ? (
                        <div className="rounded-md border divide-y">
                          {workOrderInfo.appointments.map((appt) => (
                            <div key={appt.id} className="flex items-center justify-between px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
                                <span className="text-sm font-medium">{appt.name}</span>
                              </div>
                              <Badge variant={appt.attachments.length > 0 ? "secondary" : "outline"} className="text-xs">
                                {appt.attachments.length > 0
                                  ? `${appt.attachments.length} file${appt.attachments.length === 1 ? "" : "s"}`
                                  : "no files"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 gap-2">
                          <FolderArchive className="size-8 text-muted-foreground/50" />
                          <p className="text-sm text-muted-foreground">No appointments found.</p>
                        </div>
                      )}
                    </div>

                    {/* Download button — only shown if there are files */}
                    {workOrderInfo.total_attachments > 0 && (
                      <>
                        {/* <Separator /> */}
                        <Button
                          onClick={() => {
                            if (workOrderInfo.status?.toLowerCase() === "in progress") {
                              setConfirmContext("workorder");
                              setIsConfirmOpen(true);
                            } else {
                              void handleWoBulkDownload();
                            }
                          }}
                          disabled={isDownloading}
                          className="w-full sm:w-auto gap-2"
                        >
                          <Download className="size-4" />
                          Download All ({workOrderInfo.total_attachments} files across {workOrderInfo.total_appointments} appointments)
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-sm break-words">{value || "—"}</span>
    </div>
  );
}