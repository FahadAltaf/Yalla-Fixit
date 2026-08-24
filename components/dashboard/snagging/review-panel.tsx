"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarPlus,
  CheckCircle2,
  FileText,
  Flag,
  ImageOff,
  MapPin,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingPhoto,
  type SnaggingTask,
} from "@/types/types";

import { AdditionalVisitDialog } from "./additional-visit-dialog";
import { RejectInspectionDialog } from "./reject-inspection-dialog";
import {
  SectionCard,
  SeverityBadge,
  SnagIndex,
  TaskStatusBadge,
  formatGstDateTime,
} from "./shared";

type Snag = NonNullable<SnaggingTask["snags"]>[number];

/**
 * The review panel: everything a manager needs to accept or reject one
 * inspection.
 *
 * A manager approving a report accepts liability for it, so the panel
 * leads with the four numbers that decide the call (snags, high
 * severity, area coverage, media received), states plainly when media
 * is still arriving, and then lets them walk every snag with its
 * evidence. Flagging is a reviewer's scratch pad: it tallies what to
 * mention when sending back, and clears when the panel reloads.
 */
export function ReviewPanel({
  task,
  onChanged,
}: {
  task: SnaggingTask;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [working, setWorking] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SnaggingPhoto | null>(null);
  const [detail, setDetail] = useState<Snag | null>(null);
  const [visitOpen, setVisitOpen] = useState(false);

  const canApprove = hasResourceAction(user, ResourceType.SNAGGING, ActionType.APPROVE);
  const canCreate = hasResourceAction(user, ResourceType.SNAGGING, ActionType.CREATE);

  const snags = useMemo(() => task.snags ?? [], [task]);
  const areas = task.areas ?? [];

  const highCount = snags.filter((snag) => snag.severity === "high").length;
  const confirmedAreas = areas.filter((area) => area.confirmed_at).length;
  const pendingArea = areas.find((area) => !area.confirmed_at);
  // Rooms the inspector could not fully reach (R1-R6/J3). Surfaced so a
  // coordinator sees why an area carries no snags — a locked door, not a
  // clean pass — before approving.
  const accessIssues = areas.filter(
    (area) => area.access_state && area.access_state !== "accessible",
  );
  const photoTotal = snags.reduce((sum, snag) => sum + (snag.photos?.length ?? 0), 0);
  const snagsWithPhoto = snags.filter((snag) => (snag.photos?.length ?? 0) > 0).length;

  const awaitingDecision = task.status === "submitted" || task.status === "in_review";

  function toggleFlag(id: string) {
    setFlagged((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve() {
    setWorking(true);
    try {
      await snaggingService.approveTask(task.id);
      toast.success("Inspection approved. Open the report to send it to the client.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not approve");
    } finally {
      setWorking(false);
    }
  }

  async function openRound() {
    setWorking(true);
    try {
      const round = await snaggingService.openRound(task.id, {});
      toast.success(`Round ${round.round_number} opened with ${round.carried_snags} snag(s)`);
      window.location.href = `/snagging/${round.id}/desnag`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open a round");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs">{task.code}</span>
              <TaskStatusBadge status={task.status} />
              {task.visit_type === "additional" ? (
                <Badge variant="outline">Additional visit</Badge>
              ) : task.round_number > 1 ? (
                <Badge variant="outline">Round {task.round_number}</Badge>
              ) : null}
              {task.visit_type === "additional" && (task.visit_charge ?? 0) > 0 ? (
                <span className="text-muted-foreground text-xs">
                  Charge AED {task.visit_charge!.toLocaleString()}
                </span>
              ) : null}
            </div>
            <h2 className="text-2xl">{task.property?.unit_label}</h2>
            <p className="text-muted-foreground text-sm">
              {[
                task.property?.building_name,
                task.property?.client_name,
                task.assignees?.find((a) => a.role === "technician")?.user_profile?.full_name
                  ? `inspected by ${task.assignees.find((a) => a.role === "technician")?.user_profile?.full_name}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {["submitted", "in_review", "approved", "delivered"].includes(task.status) ? (
              <Button asChild variant="outline">
                <Link href={`/snagging/${task.id}/report`}>
                  <FileText className="size-4" />
                  Report
                </Link>
              </Button>
            ) : null}
            {awaitingDecision && canApprove ? (
              <>
                <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={working}>
                  <XCircle className="size-4" />
                  Send back
                </Button>
                <Button onClick={() => void approve()} disabled={working}>
                  <CheckCircle2 className="size-4" />
                  Approve inspection
                </Button>
              </>
            ) : null}
            {(task.status === "approved" || task.status === "delivered") && canCreate ? (
              <>
                <Button variant="outline" onClick={() => void openRound()} disabled={working}>
                  <RotateCcw className="size-4" />
                  Open de-snag round
                </Button>
                <Button variant="outline" onClick={() => setVisitOpen(true)} disabled={working}>
                  <CalendarPlus className="size-4" />
                  Additional visit
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4">
          <Stat label="Snags" value={snags.length} caption={`across ${areas.length} areas`} />
          <Stat
            label="High severity"
            value={highCount}
            caption="must clear before handover"
            tone={highCount > 0 ? "bad" : "neutral"}
          />
          <Stat
            label="Areas confirmed"
            value={`${confirmedAreas} / ${areas.length}`}
            caption={pendingArea ? `${pendingArea.name} still pending` : "all walked"}
          />
          <Stat
            label="Media"
            value={`${snagsWithPhoto} / ${snags.length}`}
            caption={`${photoTotal} files received`}
          />
        </div>

        {task.status === "rejected" && task.rejection_reason ? (
          <div className="border-danger/30 bg-danger/5 border-t px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-danger text-sm font-medium">Sent back for correction</p>
              {task.rejection_category ? (
                <span className="bg-danger/10 text-danger rounded px-2 py-0.5 text-xs font-medium capitalize">
                  {task.rejection_category.replace(/_/g, " ")}
                </span>
              ) : null}
              {(task.rejection_count ?? 0) > 1 ? (
                <span className="text-muted-foreground text-xs">· {task.rejection_count}× returned</span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">{task.rejection_reason}</p>
            {task.remediation_due_at ? <RemediationDue due={task.remediation_due_at} /> : null}
          </div>
        ) : awaitingDecision ? (
          <div className="border-warning/30 bg-warning/5 border-t px-5 py-3">
            <p className="text-sm">
              {snagsWithPhoto === snags.length
                ? "Every snag has at least one photo."
                : `${snags.length - snagsWithPhoto} snag(s) have no photo yet.`}{" "}
              Approving accepts the snag records; media keeps arriving after.
            </p>
          </div>
        ) : null}
      </Card>

      {accessIssues.length > 0 ? (
        <SectionCard
          title="Access issues"
          description={`${accessIssues.length} area(s) not fully inspected`}
          bodyClassName="border-t"
        >
          <ul>
            {accessIssues.map((area) => (
              <li
                key={area.id}
                className="flex flex-wrap items-start gap-3 border-b px-5 py-3 last:border-b-0"
              >
                <span
                  className={cn(
                    "mt-0.5 rounded-md px-2 py-0.5 text-xs font-medium",
                    area.access_state === "not_accessible"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-warning/10 text-warning",
                  )}
                >
                  {area.access_state === "not_accessible" ? "No access" : "Limited access"}
                </span>
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{area.name}</p>
                  {area.access_reason ? (
                    <p className="text-muted-foreground mt-0.5 text-sm">{area.access_reason}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Walk the snags"
        description={`${snags.length} snags · ${flagged.size} flagged`}
        bodyClassName="border-t"
      >
        {snags.length === 0 ? (
          <p className="text-muted-foreground px-5 py-10 text-center text-sm">
            No defects recorded. Every area was signed off clear.
          </p>
        ) : (
          <ul>
            {snags.map((snag, index) => (
              <li
                key={snag.id}
                className={cn(
                  "flex flex-wrap items-start gap-3 border-b px-5 py-4 last:border-b-0",
                  flagged.has(snag.id) && "bg-warning/5",
                )}
              >
                <SnagIndex index={index + 1} severity={snag.severity} />

                <div className="min-w-48 flex-1">
                  <button
                    type="button"
                    onClick={() => setDetail(snag)}
                    className="hover:text-primary text-left font-medium hover:underline"
                  >
                    {[snag.area?.name ?? snag.area_label, snag.element_label, snag.defect_label]
                      .filter(Boolean)
                      .join(" · ")}
                  </button>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    <span className="font-mono text-xs">{snag.snag_code}</span>
                    {snag.note ? <span> · {snag.note}</span> : null}
                  </p>

                  {(snag.photos?.length ?? 0) > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(snag.photos ?? []).map((photo) =>
                        photo.signed_url ? (
                          <button
                            key={photo.id}
                            type="button"
                            onClick={() => setPreview(photo)}
                            className="focus-visible:ring-ring relative size-12 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <Image
                              src={photo.signed_url}
                              alt=""
                              fill
                              unoptimized
                              sizes="48px"
                              className="object-cover"
                            />
                          </button>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  {snag.pin_x !== null && snag.pin_x !== undefined ? (
                    <MapPin className="text-muted-foreground size-4" aria-label="Pinned on plan" />
                  ) : null}
                  <SeverityBadge severity={snag.severity} />
                  {(snag.photos?.length ?? 0) > 0 ? (
                    <Badge variant="secondary" className="bg-success/10 text-success border-0">
                      Synced
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-warning/10 text-warning border-0">
                      No photo
                    </Badge>
                  )}
                  {awaitingDecision ? (
                    <Button
                      variant={flagged.has(snag.id) ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleFlag(snag.id)}
                    >
                      <Flag className="size-3.5" />
                      {flagged.has(snag.id) ? "Flagged" : "Flag"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <RejectInspectionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        taskId={task.id}
        onRejected={onChanged}
      />

      <AdditionalVisitDialog taskId={task.id} open={visitOpen} onOpenChange={setVisitOpen} />

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Photo evidence</DialogTitle>
            <DialogDescription>
              Captured {formatGstDateTime(preview?.taken_at)}
              {preview?.gps_lat && preview?.gps_lng
                ? ` · ${preview.gps_lat.toFixed(5)}, ${preview.gps_lng.toFixed(5)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {preview?.signed_url ? (
            <Image
              src={preview.signed_url}
              alt="Snag evidence"
              width={1280}
              height={960}
              unoptimized
              className="h-auto w-full rounded-md object-contain"
            />
          ) : (
            <div className="text-muted-foreground flex h-64 items-center justify-center">
              <ImageOff className="mr-2 size-5" /> This photo is no longer available
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SnagDetailDialog
        snag={detail}
        onClose={() => setDetail(null)}
        onOpenPhoto={(photo) => setPreview(photo)}
      />
    </div>
  );
}

/** Everything captured for one snag: classification, note, pin, and evidence. */
function SnagDetailDialog({
  snag,
  onClose,
  onOpenPhoto,
}: {
  snag: Snag | null;
  onClose: () => void;
  onOpenPhoto: (photo: SnaggingPhoto) => void;
}) {
  const photos = (snag?.photos ?? []).filter((p) => p.signed_url);
  return (
    <Dialog open={Boolean(snag)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{snag?.defect_label ?? "Snag"}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{snag?.snag_code}</span>
          </DialogDescription>
        </DialogHeader>

        {snag ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Detail label="Area" value={snag.area?.name ?? snag.area_label} />
              <Detail label="Element" value={snag.element_label} />
              <Detail label="Defect" value={snag.defect_label} />
              <Detail label="Severity" value={<SeverityBadge severity={snag.severity} />} />
              <Detail label="Status" value={snag.status} />
              <Detail
                label="Pin on plan"
                value={
                  snag.pin_x !== null && snag.pin_x !== undefined && snag.pin_y !== null && snag.pin_y !== undefined
                    ? `${Math.round(Number(snag.pin_x) * 100)}%, ${Math.round(Number(snag.pin_y) * 100)}%`
                    : "Not placed"
                }
              />
            </dl>

            {snag.note ? (
              <div>
                <p className="text-muted-foreground text-xs">Note</p>
                <p className="mt-0.5">{snag.note}</p>
              </div>
            ) : null}

            <div>
              <p className="text-muted-foreground mb-1.5 text-xs">
                Evidence ({photos.length} {photos.length === 1 ? "file" : "files"})
              </p>
              {photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => onOpenPhoto(photo)}
                      className="focus-visible:ring-ring relative aspect-square overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Image
                        src={photo.signed_url as string}
                        alt=""
                        fill
                        unoptimized
                        sizes="120px"
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2 py-4">
                  <ImageOff className="size-4" /> No photo uploaded yet.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{value || "—"}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  caption?: string;
  tone?: "neutral" | "bad";
}) {
  return (
    <div className="bg-card p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad" && "text-danger",
        )}
      >
        {value}
      </p>
      {caption ? <p className="text-muted-foreground mt-1 text-xs">{caption}</p> : null}
    </div>
  );
}

/** The remediation SLA deadline for a returned inspection (§5.3). */
function RemediationDue({ due }: { due: string }) {
  const deadline = new Date(due);
  const overdue = deadline.getTime() < Date.now();
  const when = deadline.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  });
  return (
    <p className={cn("mt-1 text-xs", overdue ? "text-danger font-medium" : "text-muted-foreground")}>
      {overdue ? `Fix overdue — was due ${when}` : `Fix due by ${when}`}
    </p>
  );
}
