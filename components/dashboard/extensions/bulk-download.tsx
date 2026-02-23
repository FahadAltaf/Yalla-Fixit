"use client";

import { useCallback, useMemo, useState } from "react";

import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Attachment, ServiceAppointment } from "@/types/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Search,
  Download,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Paperclip,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/ui/empty-state";

const SEARCH_ENDPOINT =
  "https://primary-production-6170.up.railway.app/webhook/a62d1e0d-1808-48cc-a3f7-754c02d8d10b";

// Optimized: 6 concurrent downloads instead of 3
const CONCURRENT_DOWNLOADS = 6;

type DownloadStatus = "idle" | "downloading" | "zipping" | "finished" | "error";

interface DownloadState {
  status: DownloadStatus;
  completed: number;
  failed: number;
  total: number;
  currentFiles: string[];
}

const initialDownloadState: DownloadState = {
  status: "idle",
  completed: 0,
  failed: 0,
  total: 0,
  currentFiles: [],
};

// ─── Semaphore for controlled concurrency ────────────────────────────────────
function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < limit) {
        active++;
        resolve();
      } else {
        queue.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  return { acquire, release };
}

export function ExtensionsPageClient() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [appointment, setAppointment] = useState<ServiceAppointment | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>(initialDownloadState);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { settings } = useAuth();

  const hasAttachments = !!appointment?.attachments?.length;
  const isDownloading =
    downloadState.status === "downloading" || downloadState.status === "zipping";

  const progressValue =
    downloadState.total > 0
      ? ((downloadState.completed + downloadState.failed) / downloadState.total) * 100
      : 0;

  const statusVariant = useMemo(() => {
    if (!appointment?.status) return "default" as const;
    const normalized = appointment.status.toLowerCase();
    if (normalized === "completed") return "success" as const;
    if (normalized === "in progress") return "warning" as const;
    return "destructive" as const;
  }, [appointment?.status]);

  // ─── Search ──────────────────────────────────────────────────────────────
  const handleSearch = useCallback(
    async (value?: string) => {
      const name = (value ?? query).trim();
      if (!name) {
        toast.error("Please enter a service appointment name.");
        return;
      }

      setIsSearching(true);
      setSearchError(null);
      setAppointment(null);

      try {
        const res = await fetch(SEARCH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (!res.ok) throw new Error(`Search failed (${res.status})`);

        const data = (await res.json()) as ServiceAppointment | null;

        if (!data || !data.id) {
          setSearchError("No appointment found. Please check the name and try again.");
          return;
        }

        setAppointment(data);
      } catch (error) {
        console.error("Error searching appointment:", error);
        setSearchError("No appointment found. Please check the name and try again.");
      } finally {
        setIsSearching(false);
      }
    },
    [query]
  );

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    void handleSearch();
  };

  // ─── Download ─────────────────────────────────────────────────────────────
  const handleDownloadAll = useCallback(async () => {
    if (!appointment?.attachments?.length) return;

    const attachments = appointment.attachments;

    setDownloadState({
      status: "downloading",
      completed: 0,
      failed: 0,
      total: attachments.length,
      currentFiles: [],
    });
    setIsDialogOpen(true);

    const semaphore = createSemaphore(CONCURRENT_DOWNLOADS);
    let successCount = 0;
    const failedFiles: Attachment[] = [];

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const fetchOne = async (attachment: Attachment, index: number) => {
        await semaphore.acquire();

        const fileName = attachment.File_Name || `attachment-${index + 1}`;

        // Track "currently downloading" filenames for UI
        setDownloadState((prev) => ({
          ...prev,
          currentFiles: [...prev.currentFiles.slice(-4), fileName],
        }));

        try {
          const fileId = attachment["$file_id"];
          const response = await fetch(
            `/api/zoho-file?file_id=${encodeURIComponent(fileId)}&token=${settings?.oauth_access_token}`
          );

          if (!response.ok) throw new Error(`Failed to download ${fileName}`);

          const buffer = await response.arrayBuffer();
          zip.file(fileName, buffer);
          successCount++;

          setDownloadState((prev) => ({
            ...prev,
            completed: prev.completed + 1,
          }));
        } catch (err) {
          console.error("Failed to download attachment:", err);
          failedFiles.push(attachment);

          setDownloadState((prev) => ({
            ...prev,
            failed: prev.failed + 1,
          }));
        } finally {
          semaphore.release();
        }
      };

      // Kick off all downloads — semaphore controls concurrency
      await Promise.all(attachments.map((att, i) => fetchOne(att, i)));

      if (successCount === 0) {
        setDownloadState((prev) => ({ ...prev, status: "error" }));
        toast.error("Failed to download any attachments. Please try again.");
        return;
      }

      // Zipping phase
      setDownloadState((prev) => ({ ...prev, status: "zipping" }));

      const blob = await zip.generateAsync({ type: "blob" });
      const zipFileName = `${appointment.name}_attachments.zip`;
      saveAs(blob, zipFileName);

      setDownloadState((prev) => ({
        ...prev,
        status: "finished",
        completed: attachments.length,
        currentFiles: [],
      }));

      if (failedFiles.length > 0) {
        toast.warning(
          `Downloaded ${successCount} of ${attachments.length} files. ${failedFiles.length} failed.`
        );
      } else {
        toast.success(`All ${successCount} files downloaded successfully!`);
      }
    } catch (error) {
      console.error("Bulk download failed:", error);
      setDownloadState((prev) => ({ ...prev, status: "error" }));
      toast.error("Failed to download attachments. Please try again.");
    }
  }, [appointment, settings]);

  const handleCloseDialog = () => {
    if (isDownloading) return; // prevent close while downloading
    setIsDialogOpen(false);
    setTimeout(() => setDownloadState(initialDownloadState), 300);
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Download Dialog ── */}
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
              {downloadState.status === "finished"
                ? "Download Complete"
                : downloadState.status === "error"
                ? "Download Failed"
                : downloadState.status === "zipping"
                ? "Creating ZIP"
                : "Downloading Files"}
            </DialogTitle>
            <DialogDescription>
              {downloadState.status === "downloading" &&
                `Downloading ${downloadState.total} attachment${downloadState.total === 1 ? "" : "s"} with ${CONCURRENT_DOWNLOADS} parallel threads`}
              {downloadState.status === "zipping" &&
                "Compressing all files into a ZIP archive…"}
              {downloadState.status === "finished" &&
                `Successfully packaged ${downloadState.completed} file${downloadState.completed === 1 ? "" : "s"}`}
              {downloadState.status === "error" &&
                "Something went wrong during the download."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Status icon */}
            <div className="flex justify-center">
              {downloadState.status === "finished" && (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="size-14 text-green-500 animate-in zoom-in-50 duration-300" />
                  <p className="text-sm text-muted-foreground">
                    Your ZIP file is saving…
                  </p>
                </div>
              )}
              {downloadState.status === "error" && (
                <XCircle className="size-14 text-destructive animate-in zoom-in-50 duration-300" />
              )}
              {(downloadState.status === "downloading" ||
                downloadState.status === "zipping") && (
                <div className="w-full space-y-3">
                  {/* Progress bar */}
                  <Progress value={downloadState.status === "zipping" ? 100 : progressValue} className="h-2.5" />

                  {/* Stats row */}
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {downloadState.status === "zipping"
                        ? "Zipping…"
                        : `${downloadState.completed + downloadState.failed} / ${downloadState.total} processed`}
                    </span>
                    <span className="flex items-center gap-1">
                      {downloadState.status === "downloading" && (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      {downloadState.status === "zipping"
                        ? "Compressing"
                        : `${Math.round(progressValue)}%`}
                    </span>
                  </div>


                  {/* Currently downloading filenames */}
                  {downloadState.currentFiles.length > 0 &&
                    downloadState.status === "downloading" && (
                      <div className="rounded-md bg-muted/50 p-2 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Active downloads:
                        </p>
                        {downloadState.currentFiles.slice(-3).map((f, i) => (
                          <p
                            key={i}
                            className="text-xs text-muted-foreground truncate flex items-center gap-1.5"
                          >
                            <Loader2 className="size-3 animate-spin shrink-0" />
                            {f}
                          </p>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* Close/Done button */}
            {(downloadState.status === "finished" ||
              downloadState.status === "error") && (
              <Button className="w-full" onClick={handleCloseDialog}>
                {downloadState.status === "finished" ? "Done" : "Close"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Main Card ── */}
      <Card className="w-full flex-1  relative top-px right-px gap-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex  gap-1 flex-col">
              <CardTitle className="text-xl flex items-center gap-2">
                <Download className="size-5 text-primary" />
                Bulk Download
              </CardTitle>
              <CardDescription>
                Download all attachments for a service appointment by name.
              </CardDescription>
            </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Search form */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-2">
              {/* <Label htmlFor="appointment-name">Service Appointment Name</Label> */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="appointment-name"
                  placeholder="e.g. AP-4"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={isSearching}
                  className="pl-9"
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full sm:w-auto min-w-[110px]"
              disabled={isSearching}
            >
              {isSearching ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Searching…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Search className="size-4" />
                  Search
                </span>
              )}
            </Button>
          </form>

          {/* Error state */}
          {searchError && (
            <div className="">
           <EmptyState
            title="Appointment not found"
            description="The appointment you are looking for does not exist. Please check the name and try again."
            icon={<AlertCircle className="" />}
            // action={{ label: "Try again", onClick: () => setSearchError(null), variant: "default" }}
           />
           </div>
          )}

          {/* Loading skeleton */}
          {isSearching && !searchError && (
            <Card className="border-dashed">
              <CardHeader>
                <Skeleton className="h-5 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                {[32, 56, 40].map((w, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className={`h-4 w-${w > 50 ? "full max-w-md" : "full max-w-sm"}`} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {!appointment && !searchError && !isSearching && (
            <EmptyState
            title="Search for an appointment"
            description="Enter the name of the appointment you are looking for and click the search button."
            icon={<Search className="" />}
           />
          )}

          {/* Appointment details */}
          {appointment && !isSearching && (
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Appointment Details</CardTitle>
                  <Badge
                    variant={
                      statusVariant === "success"
                        ? "default"
                        : statusVariant === "warning"
                        ? "outline"
                        : "destructive"
                    }
                    className="capitalize"
                  >
                    {appointment.status}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-5">
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <FieldRow label="ID" value={appointment.id} />
                  <FieldRow label="Name" value={appointment.name} />
                  <FieldRow label="Contact Name" value={appointment.contact_name} />
                  <FieldRow label="Type" value={appointment.type} />
                  <FieldRow label="Address" value={appointment.address} />
                  <FieldRow label="Summary" value={appointment.summary} />
                </div>

                <Separator />

                {/* Attachments section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Paperclip className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Attachments</span>
                    </div>
                    {hasAttachments && (
                      <Badge variant="secondary">
                        {appointment.attachments!.length} file
                        {appointment.attachments!.length === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>

                  {!hasAttachments ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center gap-2">
                      <Paperclip className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        No attachments available for this appointment.
                      </p>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => void handleDownloadAll()}
                      disabled={isDownloading}
                      className="w-full sm:w-auto gap-2"
                    >
                      <Download className="size-4" />
                      Download All ({appointment.attachments!.length} files)
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function FieldRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className="text-sm break-words">{value || "—"}</span>
    </div>
  );
}