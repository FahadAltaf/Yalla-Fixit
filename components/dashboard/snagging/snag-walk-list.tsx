"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  CheckCircle2,
  DoorClosed,
  ImageOff,
  ListChecks,
  MapPin,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { coverPhoto, splitEvidence } from "@/lib/snagging/evidence";
import { EvidenceThumbnail, EvidenceViewer } from "./evidence-media";

import { SnagHistory } from "./snag-history";
import type {
  SnaggingFloorPlan,
  SnaggingPhoto,
  SnaggingSeverity,
  SnaggingTask,
} from "@/types/types";

import {
  AccessIndex,
  AccessStateBadge,
  ListPager,
  PillTabs,
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
 * workspace, without the two drifting apart.
 *
 * There was a per-snag "Flag" button here. It looked like an action but
 * was component state and nothing more — no request, no column — so a
 * reviewer who flagged their way down a long list lost the lot on the
 * next reload. Notes for a send-back belong in the send-back reason,
 * which is persisted and reaches the inspector.
 */
/** The plan a snag was pinned on, if it can be resolved. */
function planForSnag(
  snag: Snag,
  plans: SnaggingFloorPlan[],
): SnaggingFloorPlan | null {
  return (
    plans.find((p) => p.id === snag.floor_plan_id) ??
    (plans.length === 1 ? plans[0] : null)
  );
}

/**
 * What the list actually holds.
 *
 * On an initial inspection every snag was captured on the walk. On a
 * round most of them were carried in to be re-checked and only a few —
 * sometimes none — are new, so "12 snags captured on this walk" was
 * telling a manager the developer had created twelve fresh defects.
 */
function describeWalk(
  snags: { round_created?: number | null }[],
  round: number,
  failedChecks: number,
): string {
  const plural = (n: number) => (n === 1 ? "snag" : "snags");
  if (round <= 1)
    return `${snags.length} ${plural(snags.length)} captured on this walk`;

  const found = snags.filter(
    (snag) => (snag.round_created ?? 1) === round,
  ).length;
  const carried = snags.length - found;
  const parts = [`${carried} carried in to re-check`];
  if (found > 0) parts.push(`${found} found on this round`);
  /*
    A failed check is outstanding work too, and it does not appear in this
    list — it lives on the Checklist tab. Naming it here is what stops a
    round reading as "snags only" and the failed checks going unnoticed.
  */
  if (failedChecks > 0) {
    parts.push(
      `${failedChecks} failed ${failedChecks === 1 ? "check" : "checks"}`,
    );
  }
  return parts.join(" · ");
}

type SeverityFilter = "all" | SnaggingSeverity;
type SortMode = "newest" | "oldest";

export function SnagWalkList({ task }: { task: SnaggingTask }) {
  const [preview, setPreview] = useState<SnaggingPhoto | null>(null);
  const [detail, setDetail] = useState<Snag | null>(null);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const all = useMemo(() => task.snags ?? [], [task]);

  /*
    On an additional visit the list carries the original inspection's
    defects as context. They are split out rather than mixed in: one set
    is what this visit found, the other is what was already known, and
    running them together would have the visit appear to have captured
    defects it never touched.
  */
  const snags = useMemo(() => all.filter((s) => !s.from_earlier_visit), [all]);
  const earlier = useMemo(() => all.filter((s) => s.from_earlier_visit), [all]);
  const plans = useMemo(() => task.floor_plans ?? [], [task]);
  const areas = task.areas ?? [];

  /*
    Filter, order, then cut to a page.

    A full inspection can carry a hundred defects, and every row mounts a
    plan pin and up to two photo thumbnails -- rendering the lot was the
    slowest thing on the job page and left a reviewer scrolling for the
    one defect they came to check. Severity is the question actually
    asked of this list ("show me the high ones"), so it is pills rather
    than a menu; the counts are of the whole walk, not the page.
  */
  const counts = useMemo(() => {
    const tally = { all: snags.length, high: 0, medium: 0, low: 0 };
    for (const snag of snags) tally[snag.severity] += 1;
    return tally;
  }, [snags]);

  const visible = useMemo(() => {
    const filtered =
      severity === "all"
        ? snags
        : snags.filter((snag) => snag.severity === severity);

    // Sorted here rather than trusted from the API: the walk arrives with
    // the task and nothing downstream guarantees its order.
    return [...filtered].sort((a, b) => {
      const left = new Date(a.created_at ?? 0).getTime();
      const right = new Date(b.created_at ?? 0).getTime();
      return sort === "newest" ? right - left : left - right;
    });
  }, [snags, severity, sort]);

  // A page that no longer exists (the filter shrank the list under it)
  // would render empty with no way back, so it clamps.
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize,
  );

  const severityTabs = [
    { value: "all" as const, label: "All", count: counts.all },
    { value: "high" as const, label: "High", count: counts.high },
    { value: "medium" as const, label: "Medium", count: counts.medium },
    { value: "low" as const, label: "Low", count: counts.low },
  ];
  // Rooms the inspector could not fully reach (R1-R6/J3). Surfaced so a
  // coordinator sees why an area carries no snags — a locked door, not a
  // clean pass — before approving.
  const accessIssues = areas.filter(
    (area) => area.access_state && area.access_state !== "accessible",
  );
  return (
    <div className="flex flex-col gap-6">
      {accessIssues.length > 0 ? (
        <SectionCard
          title="Access issues"
          icon={<DoorClosed />}
          description={`${accessIssues.length} area(s) not fully inspected`}
          bodyClassName="border-t"
        >
          <ul>
            {accessIssues.map((area) => (
              /*
                Laid out like the snag rows below: a fixed-width marker, the
                name and its detail, then the badge at the row end. The badge
                used to lead the row, and because "No access" and "Limited
                access" are different widths, every area name started at a
                different place.
              */
              <li
                key={area.id}
                className="flex flex-wrap items-start gap-3 border-b px-5 py-4 last:border-b-0"
              >
                <AccessIndex state={area.access_state!} />

                <div className="min-w-48 flex-1">
                  <p className="font-medium">{area.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {area.access_reason || "No reason given."}
                  </p>
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <AccessStateBadge state={area.access_state!} />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Walk the snags"
        icon={<ListChecks />}
        description={describeWalk(
          snags,
          task.round_number ?? 1,
          (task.checklist ?? []).filter(
            (item) => item.status === "failed" || item.status === "not_checked",
          ).length,
        )}
        bodyClassName="border-t"
      >
        {snags.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="No defects recorded"
            description="Every area on this inspection was walked and signed off clear."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
              <PillTabs
                tabs={severityTabs}
                value={severity}
                onChange={(next) => {
                  setSeverity(next);
                  setPage(0);
                }}
              />
              <div className="ml-auto flex items-center gap-1.5">
                {/* <span className="text-muted-foreground text-xs">Sort</span> */}
                <Select
                  value={sort}
                  onValueChange={(value) => {
                    setSort(value as SortMode);
                    setPage(0);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-[130px]"
                    aria-label="Sort snags"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {pageRows.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="size-6" />}
                title="No snags at this severity"
                description="Nothing on this walk was recorded at that level. Choose All to see every defect."
              />
            ) : (
              <ul>
                {pageRows.map((snag, index) => {
                  const photoCount = snag.photos?.length ?? 0;
                  const evidence = splitEvidence(
                    snag.photos,
                    task.round_number ?? 1,
                  );
                  // On a round this is the newest AFTER shot: the current state
                  // of the defect is what a reviewer scanning the list wants.
                  const cover = coverPhoto(evidence);
                  const isRound = (task.round_number ?? 1) > 1;
                  const beforeShot =
                    evidence.before.filter((p) => p.signed_url).at(-1) ?? null;
                  const afterShot =
                    evidence.after.filter((p) => p.signed_url).at(-1) ?? null;
                  const pinned =
                    snag.pin_x !== null &&
                    snag.pin_x !== undefined &&
                    snag.pin_y !== null &&
                    snag.pin_y !== undefined;
                  return (
                    <li
                      key={snag.id}
                      className="flex flex-wrap items-start gap-3 border-b px-5 py-4 last:border-b-0"
                    >
                      {/* Numbered by position in the whole filtered walk, so a
                      snag keeps its number across page turns. */}
                      <SnagIndex
                        index={safePage * pageSize + index + 1}
                        severity={snag.severity}
                      />

                      <div className="min-w-48 flex-1">
                        <button
                          type="button"
                          onClick={() => setDetail(snag)}
                          className="hover:text-primary text-left font-medium hover:underline"
                        >
                          {[
                            snag.area?.name ?? snag.area_label,
                            snag.element_label,
                            snag.defect_label,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </button>
                        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="font-mono">{snag.snag_code}</span>
                          {snag.catalogue_code ? (
                            <span>· {snag.catalogue_code}</span>
                          ) : null}
                          {snag.created_at ? (
                            <span>· {formatGstDateTime(snag.created_at)}</span>
                          ) : null}
                          {/*
                        FR-6.03 — a round mixes two kinds of defect: the
                        ones it was opened to re-check, and anything the
                        inspector found while they were there. Reading a
                        round's list without that distinction turns eleven
                        re-checks and one new find into twelve new defects.
                      */}
                          {(snag.round_created ?? 1) ===
                            (task.round_number ?? 1) &&
                            (task.round_number ?? 1) > 1 ? (
                            <span className="text-brand font-medium">
                              · New this round
                            </span>
                          ) : (snag.round_created ?? 1) > 1 ? (
                            <span>· Found on round {snag.round_created}</span>
                          ) : null}
                          <span>
                            · {photoCount}{" "}
                            {photoCount === 1 ? "photo" : "photos"}
                          </span>
                        </p>
                        {snag.note ? (
                          <p className="text-muted-foreground mt-1 text-sm">
                            {snag.note}
                          </p>
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
                          {/*
                        On a round the pair IS the record: the defect as it
                        was raised, and the state the inspector found it in.
                        Showing one thumbnail meant a reviewer had to open
                        every snag to see whether anything had changed.
                      */}
                          {isRound ? (
                            <div className="flex items-center gap-2">
                              <EvidenceThumb
                                label="Before"
                                photo={beforeShot}
                                snagCode={snag.snag_code}
                                onOpen={setPreview}
                              />
                              <ArrowRight
                                className="text-muted-foreground/50 size-3.5 shrink-0"
                                aria-hidden
                              />
                              <EvidenceThumb
                                label="After"
                                photo={afterShot}
                                snagCode={snag.snag_code}
                                onOpen={setPreview}
                              />
                              {photoCount > 2 ? (
                                <button
                                  type="button"
                                  onClick={() => setDetail(snag)}
                                  className="text-muted-foreground hover:text-foreground text-xs hover:underline"
                                >
                                  +{photoCount - 2} more
                                </button>
                              ) : null}
                            </div>
                          ) : cover ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setPreview(cover)}
                                className="focus-visible:ring-ring relative size-12 shrink-0 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
                                aria-label={`Photo evidence for ${snag.snag_code}`}
                              >
                                <EvidenceThumbnail photo={cover} />
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
                          <span className="text-muted-foreground/70 text-xs">
                            Not pinned
                          </span>
                        )}
                        <SeverityBadge severity={snag.severity} />
                        <SnagStatusBadge status={snag.status} />
                        {photoCount === 0 ? (
                          <Badge
                            variant="secondary"
                            className="bg-warning/10 text-warning border-0"
                          >
                            No photo
                          </Badge>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <ListPager
              page={safePage}
              pageSize={pageSize}
              total={visible.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              noun="snags"
              className="border-t"
            />
          </>
        )}
      </SectionCard>

      {/*
        Read-only context on an additional visit. Deliberately below the
        visit's own list and visually quieter: it is there to tell the
        inspector what has already been seen, not to be worked through.
      */}
      {earlier.length > 0 ? (
        <SectionCard
          title="Already on record"
          icon={<ListChecks />}
          description={`${earlier.length} defect${earlier.length === 1 ? "" : "s"} from the original inspection. Shown for context — they stay on the original and are not re-counted here.`}
          bodyClassName="border-t"
        >
          <ul className="divide-y">
            {earlier.map((snag) => (
              <li key={snag.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="text-muted-foreground font-mono text-xs">{snag.snag_code}</span>
                <span className="min-w-0 flex-1">
                  {[snag.area?.name ?? snag.area_label, snag.element_label, snag.defect_label]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <SeverityBadge severity={snag.severity} />
                <SnagStatusBadge status={snag.status} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => !open && setPreview(null)}
      >
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
            // A clip plays; a still renders. next/image cannot decode a
            // video, so every video opened here used to be a broken frame.
            <MarkedEvidence photo={preview} />
          ) : (
            <div className="text-muted-foreground flex h-64 items-center justify-center">
              <ImageOff className="mr-2 size-5" /> This photo is no longer
              available
            </div>
          )}
          {preview ? <PhotoExif photo={preview} /> : null}
        </DialogContent>
      </Dialog>

      <SnagDetailDialog
        snag={detail}
        plans={task.floor_plans ?? []}
        visitRound={task.round_number ?? 1}
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
  visitRound,
  onClose,
  onOpenPhoto,
}: {
  snag: Snag | null;
  plans: SnaggingFloorPlan[];
  /** The round being viewed, which is what makes a photo "before" or "after". */
  visitRound: number;
  onClose: () => void;
  onOpenPhoto: (photo: SnaggingPhoto) => void;
}) {
  const evidence = splitEvidence(snag?.photos, visitRound);
  const photos = [...evidence.before, ...evidence.after].filter(
    (p) => p.signed_url,
  );
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
              <Detail
                label="Severity"
                value={<SeverityBadge severity={snag.severity} />}
              />
              {/* The §5.2 label, not the database value: a reviewer
                  should read "Poor quality fix", not
                  "verified_poor_quality". */}
              <Detail
                label="Status"
                value={<SnagStatusBadge status={snag.status} />}
              />
              <Detail
                label="Round"
                value={snag.round_created ? `Round ${snag.round_created}` : "1"}
              />
              <Detail
                label="Captured"
                value={formatGstDateTime(snag.created_at)}
              />
              <Detail
                label="Code"
                value={
                  <span className="font-mono text-xs">
                    {snag.catalogue_code}
                  </span>
                }
              />
            </dl>

            {/* Where the defect actually is, rather than a pair of
                percentages a reviewer has to imagine. */}
            <div>
              <p className="text-muted-foreground mb-1.5 text-xs">
                Pin on plan
              </p>
              <SnagPlanPin snag={snag} plans={plans} />
            </div>

            {/* FR-8.05 — the whole journey, so a reviewer can see that
                this is the third time the defect has come back. */}
            <div>
              <p className="text-muted-foreground mb-2 text-xs">
                Status history
              </p>
              <SnagHistory snagId={snag.id} />
            </div>

            {snag.note ? (
              <div>
                <p className="text-muted-foreground text-xs">Note</p>
                <p className="mt-0.5">{snag.note}</p>
              </div>
            ) : null}

            {/*
              Before and after, side by side and labelled.

              On a round these two answer the only question the visit
              exists to ask, and they were rendered as one undifferentiated
              pile — a reviewer could not tell the shot of the broken
              handle from the shot of the repaired one. On the original
              inspection there is no "before", so it stays a plain list.
            */}
            {photos.length === 0 ? (
              <div>
                <p className="text-muted-foreground mb-1.5 text-xs">Evidence</p>
                <p className="text-muted-foreground flex items-center gap-2 py-4">
                  <ImageOff className="size-4" /> No photo uploaded yet.
                </p>
              </div>
            ) : visitRound > 1 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <EvidenceGroup
                  label="Before"
                  hint="As the defect was raised"
                  photos={evidence.before}
                  onOpenPhoto={onOpenPhoto}
                  emptyHint="No photo carried from the earlier visit."
                />
                <EvidenceGroup
                  label="After"
                  hint={`Shot on round ${visitRound}`}
                  photos={evidence.after}
                  onOpenPhoto={onOpenPhoto}
                  emptyHint="Nothing shot on this round yet."
                />
              </div>
            ) : (
              <EvidenceGroup
                label={`Evidence (${photos.length} ${photos.length === 1 ? "file" : "files"})`}
                photos={evidence.after}
                onOpenPhoto={onOpenPhoto}
                emptyHint="No photo uploaded yet."
                columns={4}
              />
            )}
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
        Pinned at {Math.round(Number(x) * 100)}%, {Math.round(Number(y) * 100)}%
        — the plan is not available to display.
      </p>
    );
  }

  return (
    <div
      className="bg-muted relative mx-auto max-w-full overflow-hidden rounded-md border"
      style={{
        aspectRatio:
          plan.width && plan.height
            ? `${plan.width} / ${plan.height}`
            : "4 / 3",
        // Width-led: the box is never wider than its column, so a
        // landscape plan cannot push the dialog sideways. It still keeps
        // the plan's own ratio, which is what makes the stored fraction
        // map exactly onto an offset. A tall plan simply scrolls with
        // the rest of the dialog.
        ...(compact ? { height: 48, width: "auto" } : { width: "100%" }),
      }}
    >
      <Image
        src={plan.signed_url}
        alt={plan.label}
        fill
        unoptimized
        className="object-contain"
      />
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
 * A captioned thumbnail in the before/after pair.
 *
 * Renders an explicit placeholder when the half is missing rather than
 * collapsing, so the pair keeps its shape down the list and a defect with
 * no after shot reads as work outstanding rather than as a layout glitch.
 */
function EvidenceThumb({
  label,
  photo,
  snagCode,
  onOpen,
}: {
  label: string;
  photo: SnaggingPhoto | null;
  snagCode: string;
  onOpen: (photo: SnaggingPhoto) => void;
}) {
  return (
    <figure className="flex flex-col items-center gap-0.5">
      {photo ? (
        <button
          type="button"
          onClick={() => onOpen(photo)}
          className="focus-visible:ring-ring relative size-12 shrink-0 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`${label} photo for ${snagCode}`}
        >
          <EvidenceThumbnail photo={photo} />
        </button>
      ) : (
        <span
          className="border-muted-foreground/25 text-muted-foreground/50 flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed"
          aria-label={`No ${label.toLowerCase()} photo for ${snagCode}`}
        >
          <ImageOff className="size-4" aria-hidden />
        </span>
      )}
      <figcaption className="text-muted-foreground text-[10px] leading-none">
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * One labelled set of evidence.
 *
 * Shared by the before and after columns and by the single list an
 * original inspection shows, so all three get the same tile, the same
 * focus ring and the same empty line — and a change to any of it lands
 * everywhere at once.
 */
function EvidenceGroup({
  label,
  hint,
  photos,
  onOpenPhoto,
  emptyHint,
  columns = 3,
}: {
  label: string;
  hint?: string;
  photos: SnaggingPhoto[];
  onOpenPhoto: (photo: SnaggingPhoto) => void;
  emptyHint: string;
  columns?: 3 | 4;
}) {
  const usable = photos.filter((p) => p.signed_url);
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs">
        {label}
        {hint ? (
          <span className="text-muted-foreground/70"> · {hint}</span>
        ) : null}
      </p>
      {usable.length > 0 ? (
        <div
          className={cn(
            "grid gap-2",
            columns === 4 ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-3",
          )}
        >
          {usable.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => onOpenPhoto(photo)}
              className="focus-visible:ring-ring relative aspect-square overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
            >
              <EvidenceThumbnail photo={photo} />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground/80 border-muted-foreground/20 rounded-md border border-dashed px-3 py-4 text-xs">
          {emptyHint}
        </p>
      )}
    </div>
  );
}

/**
 * FR-6.05 — the photo with the defect spot the inspector marked on it.
 *
 * `marker_x` / `marker_y` are stored as fractions of the image, not pixels,
 * so the same pair lands correctly whatever the photo's dimensions or aspect
 * ratio: the overlay is positioned in percentages over a wrapper that the
 * image itself sizes. They were captured and stored but drawn nowhere, which
 * left an approver reading "there is a defect in this wall" over a photo of
 * a whole wall.
 */
function MarkedEvidence({ photo }: { photo: SnaggingPhoto }) {
  const x = typeof photo.marker_x === "number" ? photo.marker_x : null;
  const y = typeof photo.marker_y === "number" ? photo.marker_y : null;
  // A marker outside the frame is corrupt data, not a spot worth drawing.
  const placed =
    x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1;

  if (!placed) return <EvidenceViewer photo={photo} />;

  return (
    <div className="relative">
      <EvidenceViewer photo={photo} />
      <span
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${x! * 100}%`, top: `${y! * 100}%` }}
        aria-hidden
      >
        <span className="border-danger bg-danger/25 block size-7 rounded-full border-2 shadow-[0_0_0_2px_rgba(255,255,255,0.85)]" />
      </span>
      <span className="bg-danger absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
        Marked defect
      </span>
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
  const shot = [
    exposure ? `${exposure}s` : null,
    fnumber ? `ƒ/${fnumber}` : null,
    iso ? `ISO ${iso}` : null,
  ]
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

  /*
    Did the camera give us anything, or only what the upload knew?

    Dimensions, file size and the upload timestamp exist for every photo, so
    a panel built from those alone looks like EXIF while carrying none. An
    approver judging evidence needs to be able to tell the difference.
  */
  const hasCameraData = Boolean(
    camera || lens || shot || software || hasGps || (photo.exif && Object.keys(photo.exif).length > 0),
  );

  return (
    <div className="bg-muted/40 rounded-md border p-4">
      <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        Capture data (EXIF)
      </p>
      {!hasCameraData ? (
        <p className="text-muted-foreground mb-3 text-xs">
          This photo carries no camera metadata — the device did not record
          it, or it was stripped before upload. What follows is what the
          upload itself knows.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map((row) => (
          <Detail key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </div>
  );
}
