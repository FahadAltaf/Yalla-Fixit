"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Flag, ImageOff, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { SnaggingFloorPlan, SnaggingPhoto, SnaggingTask } from "@/types/types";

import {
  SectionCard,
  SeverityBadge,
  SnagIndex,
  SnagStatusBadge,
  formatGstDateTime,
} from "./shared";

type Snag = NonNullable<SnaggingTask["snags"]>[number];

/**
 * The snags an inspector captured, and the evidence behind each one.
 *
 * Split out of the review panel so the same list can be the body of a
 * tab on the job detail page and the lower half of the approvals
 * workspace, without the two drifting apart. Flagging is a reviewer's
 * scratch pad: it tallies what to mention when sending back, and clears
 * when the panel reloads.
 */
/** The plan a snag was pinned on, if it can be resolved. */
function planForSnag(snag: Snag, plans: SnaggingFloorPlan[]): SnaggingFloorPlan | null {
  return plans.find((p) => p.id === snag.floor_plan_id) ?? (plans.length === 1 ? plans[0] : null);
}

export function SnagWalkList({ task }: { task: SnaggingTask }) {
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<SnaggingPhoto | null>(null);
  const [detail, setDetail] = useState<Snag | null>(null);

  const snags = useMemo(() => task.snags ?? [], [task]);
  const plans = useMemo(() => task.floor_plans ?? [], [task]);
  const areas = task.areas ?? [];
  // Rooms the inspector could not fully reach (R1-R6/J3). Surfaced so a
  // coordinator sees why an area carries no snags — a locked door, not a
  // clean pass — before approving.
  const accessIssues = areas.filter(
    (area) => area.access_state && area.access_state !== "accessible",
  );
  // Flagging is only useful while a decision is still open; once the job
  // is approved or delivered the list is a record, not a worklist.
  const awaitingDecision = task.status === "submitted" || task.status === "in_review";

  function toggleFlag(id: string) {
    setFlagged((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
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
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="No defects recorded"
            description="Every area on this inspection was walked and signed off clear."
          />
        ) : (
          <ul>
            {snags.map((snag, index) => {
              const photoCount = snag.photos?.length ?? 0;
              const cover = (snag.photos ?? []).find((photo) => photo.signed_url) ?? null;
              const pinned =
                snag.pin_x !== null && snag.pin_x !== undefined &&
                snag.pin_y !== null && snag.pin_y !== undefined;
              return (
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
                  <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-mono">{snag.snag_code}</span>
                    {snag.catalogue_code ? <span>· {snag.catalogue_code}</span> : null}
                    {snag.created_at ? <span>· {formatGstDateTime(snag.created_at)}</span> : null}
                    {(snag.round_created ?? 1) > 1 ? <span>· Round {snag.round_created}</span> : null}
                    <span>
                      · {photoCount} {photoCount === 1 ? "photo" : "photos"}
                    </span>
                  </p>
                  {snag.note ? (
                    <p className="text-muted-foreground mt-1 text-sm">{snag.note}</p>
                  ) : null}

                  {/*
                    One thumbnail, not all of them. Rendering every photo
                    inline minted a signed URL per image and loaded
                    hundreds on a busy job before the reviewer had
                    scrolled; the rest open with the snag.
                  */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* The pin, in the list itself — a reviewer walking
                        the snags can see where each defect is without
                        opening every one. */}
                    {pinned ? (
                      <button
                        type="button"
                        onClick={() => setDetail(snag)}
                        className="focus-visible:ring-ring shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none"
                        aria-label={`Show ${snag.snag_code} on the plan`}
                      >
                        <SnagPlanPin snag={snag} plans={plans} compact />
                      </button>
                    ) : null}
                  {cover ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreview(cover)}
                        className="focus-visible:ring-ring relative size-12 shrink-0 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
                        aria-label={`Photo evidence for ${snag.snag_code}`}
                      >
                        <Image
                          src={cover.signed_url as string}
                          alt=""
                          fill
                          unoptimized
                          sizes="48px"
                          className="object-cover"
                        />
                      </button>
                      {photoCount > 1 ? (
                        <button
                          type="button"
                          onClick={() => setDetail(snag)}
                          className="text-muted-foreground hover:text-foreground text-xs hover:underline"
                        >
                          +{photoCount - 1} more
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {pinned ? (
                    <span
                      className="text-muted-foreground inline-flex items-center gap-1 text-xs"
                      title={`Pinned at ${Math.round(Number(snag.pin_x) * 100)}%, ${Math.round(
                        Number(snag.pin_y) * 100,
                      )}% on the plan`}
                    >
                      <MapPin className="size-3.5" aria-hidden />
                      On plan
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70 text-xs">Not pinned</span>
                  )}
                  <SeverityBadge severity={snag.severity} />
                  <SnagStatusBadge status={snag.status} />
                  {photoCount === 0 ? (
                    <Badge variant="secondary" className="bg-warning/10 text-warning border-0">
                      No photo
                    </Badge>
                  ) : null}
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
              );
            })}
          </ul>
        )}
      </SectionCard>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[88vh] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
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
          {preview ? <PhotoExif photo={preview} /> : null}
        </DialogContent>
      </Dialog>

      <SnagDetailDialog
        snag={detail}
        plans={task.floor_plans ?? []}
        onClose={() => setDetail(null)}
        onOpenPhoto={(photo) => setPreview(photo)}
      />
    </div>
  );
}

/** Everything captured for one snag: classification, note, pin, and evidence. */
function SnagDetailDialog({
  snag,
  plans,
  onClose,
  onOpenPhoto,
}: {
  snag: Snag | null;
  plans: SnaggingFloorPlan[];
  onClose: () => void;
  onOpenPhoto: (photo: SnaggingPhoto) => void;
}) {
  const photos = (snag?.photos ?? []).filter((p) => p.signed_url);
  return (
    <Dialog open={Boolean(snag)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
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
                label="Round"
                value={snag.round_created ? `Round ${snag.round_created}` : "1"}
              />
              <Detail label="Captured" value={formatGstDateTime(snag.created_at)} />
              <Detail label="Code" value={<span className="font-mono text-xs">{snag.catalogue_code}</span>} />
            </dl>

            {/* Where the defect actually is, rather than a pair of
                percentages a reviewer has to imagine. */}
            <div>
              <p className="text-muted-foreground mb-1.5 text-xs">Pin on plan</p>
              <SnagPlanPin snag={snag} plans={plans} />
            </div>

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

/**
 * The plan the snag was pinned on, with the pin.
 *
 * The container is given the plan's own aspect ratio, so an
 * object-contain image fills it exactly — that makes the stored 0..1
 * fraction map straight onto a percentage offset with no letterbox to
 * correct for.
 */
function SnagPlanPin({
  snag,
  plans,
  compact = false,
}: {
  snag: Snag;
  plans: SnaggingFloorPlan[];
  /** Row-sized preview rather than the full dialog view. */
  compact?: boolean;
}) {
  const x = snag.pin_x;
  const y = snag.pin_y;
  const placed = x !== null && x !== undefined && y !== null && y !== undefined;

  // Prefer the plan the pin was dropped on; fall back to the only plan
  // when a snag predates per-plan pinning.
  const plan = planForSnag(snag, plans);

  // The compact preview is decoration beside the row: if there is nothing
  // to draw, draw nothing rather than an explanatory box.
  if (compact && (!placed || !plan?.signed_url)) return null;

  if (!placed) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
        No pin was placed for this snag.
      </p>
    );
  }
  if (!plan?.signed_url) {
    return (
      <p className="text-muted-foreground rounded-md border px-3 py-3 text-sm">
        Pinned at {Math.round(Number(x) * 100)}%, {Math.round(Number(y) * 100)}% — the plan is not
        available to display.
      </p>
    );
  }

  return (
    <div
      className="bg-muted relative mx-auto max-w-full overflow-hidden rounded-md border"
      style={{
        aspectRatio: plan.width && plan.height ? `${plan.width} / ${plan.height}` : "4 / 3",
        // Width-led: the box is never wider than its column, so a
        // landscape plan cannot push the dialog sideways. It still keeps
        // the plan's own ratio, which is what makes the stored fraction
        // map exactly onto an offset. A tall plan simply scrolls with
        // the rest of the dialog.
        ...(compact ? { height: 48, width: "auto" } : { width: "100%" }),
      }}
    >
      <Image src={plan.signed_url} alt={plan.label} fill unoptimized className="object-contain" />
      <span
        className={cn(
          "border-background bg-danger absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow",
          compact ? "size-2.5 border" : "size-4",
        )}
        style={{ left: `${Number(x) * 100}%`, top: `${Number(y) * 100}%` }}
        aria-label={`Defect pinned at ${Math.round(Number(x) * 100)}%, ${Math.round(
          Number(y) * 100,
        )}%`}
      />
    </div>
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

/**
 * FR-6.05 — the capture metadata behind a photo, so the approver can
 * judge the evidence, not just look at it: when and where it was taken,
 * the device that took it, and the raw dimensions. EXIF is read straight
 * off the stored `exif` blob; only the keys we recognise are surfaced,
 * and the block hides itself when a photo carries nothing.
 */
function PhotoExif({ photo }: { photo: SnaggingPhoto }) {
  const exif = (photo.exif ?? {}) as Record<string, unknown>;
  const str = (...keys: string[]): string | null => {
    for (const key of keys) {
      const v = exif[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  };

  const make = str("Make", "make");
  const model = str("Model", "model");
  const camera = [make, model].filter(Boolean).join(" ") || null;
  const lens = str("LensModel", "lensModel", "LensMake");
  const software = str("Software", "software");
  const exposure = str("ExposureTime", "exposureTime");
  const fnumber = str("FNumber", "fNumber", "ApertureValue");
  const iso = str("ISOSpeedRatings", "ISO", "iso");
  const dims =
    photo.width && photo.height ? `${photo.width} × ${photo.height}` : null;
  const size =
    photo.bytes && photo.bytes > 0
      ? `${(photo.bytes / (1024 * 1024)).toFixed(1)} MB`
      : null;
  const hasGps = photo.gps_lat != null && photo.gps_lng != null;

  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (camera) rows.push({ label: "Camera", value: camera });
  if (lens) rows.push({ label: "Lens", value: lens });
  const shot = [exposure ? `${exposure}s` : null, fnumber ? `ƒ/${fnumber}` : null, iso ? `ISO ${iso}` : null]
    .filter(Boolean)
    .join(" · ");
  if (shot) rows.push({ label: "Exposure", value: shot });
  if (dims) rows.push({ label: "Dimensions", value: dims });
  if (size) rows.push({ label: "File size", value: size });
  if (software) rows.push({ label: "Software", value: software });
  rows.push({
    label: "Captured",
    value: formatGstDateTime(photo.taken_at) || "Unknown",
  });
  rows.push({
    label: "Location",
    value: hasGps ? (
      <a
        href={`https://www.google.com/maps?q=${photo.gps_lat},${photo.gps_lng}`}
        target="_blank"
        rel="noreferrer"
        className="text-brand inline-flex items-center gap-1 hover:underline"
      >
        <MapPin className="size-3.5" />
        {photo.gps_lat!.toFixed(5)}, {photo.gps_lng!.toFixed(5)}
      </a>
    ) : (
      "No GPS recorded"
    ),
  });

  return (
    <div className="bg-muted/40 rounded-md border p-4">
      <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        Capture data (EXIF)
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map((row) => (
          <Detail key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </div>
  );
}
