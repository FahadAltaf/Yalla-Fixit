"use client";

import { useCallback, useMemo, useState } from "react";

import { saveAs } from "file-saver";
import { toast } from "sonner";

import {
  Attachment,
  ServiceAppointment,
} from "@/types/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

const SEARCH_ENDPOINT =
  "https://primary-production-6170.up.railway.app/webhook/a62d1e0d-1808-48cc-a3f7-754c02d8d10b";

type DownloadState =
  | { status: "idle" }
  | { status: "downloading"; completed: number; total: number }
  | { status: "finished"; completed: number; total: number };

export function ExtensionsPageClient() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [appointment, setAppointment] = useState<ServiceAppointment | null>(
    null
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
  });

  const hasAttachments = !!appointment?.attachments?.length;

  const statusVariant = useMemo(() => {
    if (!appointment?.status) return "default" as const;
    const normalized = appointment.status.toLowerCase();
    if (normalized === "completed") return "success" as const;
    if (normalized === "in progress") return "warning" as const;
    return "destructive" as const;
  }, [appointment?.status]);

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
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name }),
        });

        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }

        const data = (await res.json()) as ServiceAppointment | null;

        if (!data || !data.id) {
          setSearchError(
            "No appointment found. Please check the name and try again."
          );
          setAppointment(null);
          return;
        }

        setAppointment(data);
      } catch (error) {
        console.error("Error searching appointment:", error);
        setAppointment(null);
        setSearchError(
          "No appointment found. Please check the name and try again."
        );
      } finally {
        setIsSearching(false);
      }
    },
    [query]
  );

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    void handleSearch();
  };

  const handleDownloadAll = useCallback(async () => {
    if (!appointment || !appointment.attachments?.length) return;

    const attachments = appointment.attachments;
    setDownloadState({
      status: "downloading",
      completed: 0,
      total: attachments.length,
    });

    let successfulDownloads = 0;
    const failedFiles: Attachment[] = [];

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      for (const [index, attachment] of attachments.entries()) {
        try {
          const fileId = attachment["$file_id"];
          const fileName = attachment.File_Name || `attachment-${index + 1}`;
          const response = await fetch(
            `/api/zoho-file?file_id=${encodeURIComponent(fileId)}`
          );

          if (!response.ok) {
            throw new Error(`Failed to download ${fileName}`);
          }

          const buffer = await response.arrayBuffer();
          zip.file(fileName, buffer);
          successfulDownloads += 1;
        } catch (error) {
          console.error("Failed to download attachment:", error);
          failedFiles.push(attachment);
        } finally {
          setDownloadState((prev) =>
            prev.status === "downloading"
              ? {
                  status: "downloading",
                  completed: Math.min(
                    (prev.completed || 0) + 1,
                    attachments.length
                  ),
                  total: attachments.length,
                }
              : prev
          );
        }
      }

      if (successfulDownloads === 0) {
        toast.error("Failed to download attachments. Please try again.");
        setDownloadState({ status: "idle" });
        return;
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const zipFileName = `${appointment.name}_attachments.zip`;
      saveAs(blob, zipFileName);

      if (failedFiles.length > 0) {
        toast.warning(
          `Downloaded ${successfulDownloads} of ${attachments.length} files. Some files could not be downloaded.`
        );
      } else {
        toast.success(`Downloaded ${successfulDownloads} files successfully.`);
      }

      setDownloadState({
        status: "finished",
        completed: attachments.length,
        total: attachments.length,
      });
    } catch (error) {
      console.error("Bulk download failed:", error);
      toast.error("Failed to download attachments. Please try again.");
      setDownloadState({ status: "idle" });
    } finally {
      setTimeout(() => {
        setDownloadState({ status: "idle" });
      }, 1500);
    }
  }, [appointment]);

  const isDownloading = downloadState.status === "downloading";
  const progressValue =
    downloadState.status === "downloading" || downloadState.status === "finished"
      ? (downloadState.completed / (downloadState.total || 1)) * 100
      : 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Extensions
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Lookup a Service Appointment by name.
        </p>
      </div> */}

      <Card>
        <CardHeader>
          <CardTitle>Search Service Appointment</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="appointment-name">
                Enter Service Appointment Name
              </Label>
              <Input
                id="appointment-name"
                placeholder="e.g. AP-4"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={isSearching}
              />
            </div>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={isSearching}
            >
              {isSearching ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin h-4 w-4"/>
                  <span>Searching</span>
                </span>
              ) : (
                "Search"
              )}
            </Button>
          </form>

          {searchError && (
            <div className="mt-4">
              <Alert variant="destructive">
                <AlertTitle>Appointment not found</AlertTitle>
                <AlertDescription>
                  No appointment found. Please check the name and try again.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {isSearching && (
        <Card>
          <CardHeader>
            <CardTitle>Loading appointment details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full max-w-sm" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full max-w-xs" />
            </div>
          </CardContent>
        </Card>
      )}

      {appointment && !isSearching && (
        <Card>
          <CardHeader>
            <CardTitle>Service Appointment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FieldRow label="ID" value={appointment.id} />
              <FieldRow label="Name" value={appointment.name} />
              <FieldRow label="Address" value={appointment.address} />
              <FieldRow label="Contact Name" value={appointment.contact_name} />
              <FieldRow label="Summary" value={appointment.summary} />
              <FieldRow label="Type" value={appointment.type} />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Status
                </span>
                <Badge
                  variant={
                    statusVariant === "success"
                      ? "default"
                      : statusVariant === "warning"
                      ? "outline"
                      : "destructive"
                  }
                >
                  {appointment.status}
                </Badge>
              </div>
            </div>

            <Separator className="my-2" />

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Attachments</span>
                {hasAttachments && (
                  <span className="text-muted-foreground text-xs">
                    {appointment.attachments!.length} file
                    {appointment.attachments!.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {!hasAttachments && (
                <p className="text-muted-foreground text-sm">
                  No attachments available.
                </p>
              )}

              {hasAttachments && (
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleDownloadAll()}
                    disabled={isDownloading}
                    className="w-full sm:w-auto"
                  >
                    {isDownloading ? (
                      <span className="flex items-center gap-2">
                        <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span>
                          Downloading{" "}
                          {downloadState.status === "downloading"
                            ? `${downloadState.completed} / ${downloadState.total}`
                            : ""}
                          ...
                        </span>
                      </span>
                    ) : (
                      `Download All Attachments (${appointment.attachments!.length} files)`
                    )}
                  </Button>

                  {(downloadState.status === "downloading" ||
                    downloadState.status === "finished") && (
                    <div className="space-y-1.5">
                      <Progress value={progressValue} />
                      <p className="text-muted-foreground text-xs">
                        Downloading{" "}
                        {downloadState.completed} / {downloadState.total}...
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="text-sm wrap-break-word">{value || "-"}</span>
    </div>
  );
}

