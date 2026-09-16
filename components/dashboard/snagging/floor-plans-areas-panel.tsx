"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  Eraser,
  ImageOff,
  Map,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Shapes,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { compressImage } from "@/lib/media/compress-image";

import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { templateFor } from "@/lib/snagging/area-templates";
import { snaggingService } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingArea,
  type SnaggingFloorPlan,
  type SnaggingPropertyType,
} from "@/types/types";

import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/actions/utils";
import AddFloorPlanDialog from "./add-floor-plan-dialog";
import { PlanZoneCanvas } from "./plan-zone-canvas";
import { zoneLabelPoint, type ZonePoint } from "@/lib/snagging/zone-geometry";

import {
  DataRow,
  DataState,
  ListSkeleton,
  SectionCard,
  SubHeading,
  SubmitButton,
  useConfirm,
} from "./shared";

/**
 * Prepares a file for upload. Images pass through with their natural size read.
 * A PDF is rendered (page 1) to a PNG so the plan is pinnable everywhere —
 * never silently stored as a non-viewable PDF (FR-3.05 #7).
 */
async function toPinnablePlan(
  file: File,
): Promise<{ file: File; width?: number; height?: number }> {
  if (file.type.startsWith("image/")) {
    // Downscaled and re-encoded before it leaves the device. The returned
    // dimensions are the ones actually uploaded, so the pin coordinates the
    // panel stores are relative to the image the report will show.
    const compressed = await compressImage(file);
    return {
      file: compressed.file,
      width: compressed.width ?? undefined,
      height: compressed.height ?? undefined,
    };
  }

  if (file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    // Point the worker at the bundled module worker.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not render the PDF");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/png"),
    );
    if (!blob) throw new Error("Could not convert the PDF to an image");
    // A page rasterised at scale 2 is a large PNG; run it through the same
    // compressor so a PDF plan does not cost several times an image one.
    const png = new File([blob], file.name.replace(/\.pdf$/i, ".png"), {
      type: "image/png",
    });
    const compressed = await compressImage(png);
    return {
      file: compressed.file,
      width: compressed.width ?? canvas.width,
      height: compressed.height ?? canvas.height,
    };
  }

  throw new Error("Floor plans must be an image (PNG/JPG) or a PDF");
}

export function FloorPlansAreasPanel({
  taskId,
  propertyType,
  bedrooms,
}: {
  taskId: string;
  /** Shapes the suggested room list, the same way it does at job creation. */
  propertyType?: SnaggingPropertyType | null;
  bedrooms?: number | null;
}) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );
  const { confirm, dialog } = useConfirm();

  const [plans, setPlans] = useState<SnaggingFloorPlan[]>([]);
  const [areas, setAreas] = useState<SnaggingArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` disables every control; `running` names the one mutation in
  // flight so only that button spins — a PDF can take seconds to convert.
  const [running, setRunning] = useState<
    null | "upload" | "pin" | "area" | "rename"
  >(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  /*
    Placement works the way it does when the job is created: pick the room
    first, then mark it. Clicking the plan cold used to open a dialog
    asking which room the pin was for, which put the question AFTER the
    answer had to be decided and made every pin a two-step affair.
  */
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [placeMode, setPlaceMode] = useState<"pin" | "zone">("pin");
  const [addAreaOpen, setAddAreaOpen] = useState(false);
  const [newAreaOnly, setNewAreaOnly] = useState("");
  const areaListRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    // setLoading(true);
    setError(null);
    try {
      const [p, a] = await Promise.all([
        snaggingService.listFloorPlans(taskId),
        snaggingService.listAreas(taskId),
      ]);
      setPlans(p);
      setAreas(a);
      setActivePlanId((cur) => cur ?? p[0]?.id ?? null);
    } catch (e) {
      // Swallowing this made a broken fetch look like a unit with no
      // plans and no areas — the inspector would just start adding them.
      setError(
        e instanceof Error ? e.message : "Could not load floor plans and areas",
      );
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePlan = plans.find((p) => p.id === activePlanId) ?? null;

  async function upload(planLabel: string, file: File) {
    setBusy(true);
    setRunning("upload");
    try {
      const prepared = await toPinnablePlan(file);
      await snaggingService.uploadFloorPlan(taskId, prepared.file, {
        // The dialog requires a label, so there is no "Floor N"
        // fallback producing plans nobody can tell apart.
        label: planLabel,
        width: prepared.width,
        height: prepared.height,
      });
      setAddOpen(false);
      toast.success(
        file.type === "application/pdf"
          ? "PDF converted and added"
          : "Floor plan added",
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not upload the plan",
      );
    } finally {
      setBusy(false);
      setRunning(null);

    }
  }

  async function removePlan(plan: SnaggingFloorPlan) {
    // The file is deleted outright, and every pin placed on it is left
    // without a plan to sit on.
    const ok = await confirm({
      title: `Remove "${plan.label}"?`,
      description:
        "The uploaded plan is deleted. Areas pinned to this floor keep their names but lose their plan and pin position, and will need re-pinning.",
      confirmText: "Remove plan",
      variant: "destructive",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await snaggingService.deleteFloorPlan(plan.id);
      if (activePlanId === plan.id) setActivePlanId(null);
      toast.success("Floor plan removed");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the plan",
      );
    } finally {
      setBusy(false);
    }
  }

  // Both the Move up/down menu items and drag-and-drop end here, so the
  // optimistic update and its rollback exist in one place.
  async function applyOrder(next: SnaggingFloorPlan[]) {
    setPlans(next);
    setBusy(true);
    try {
      await snaggingService.reorderFloorPlans(next.map((p) => p.id));
      toast.success("Floor order updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= plans.length) return;
    const next = [...plans];
    [next[index], next[target]] = [next[target], next[index]];
    await applyOrder(next);
  }

  // Drag-and-drop reordering. Move up/down stays in the row menu:
  // dragging is not reachable by keyboard, so it must not be the only way.
  async function dropPlan(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const next = [...plans];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await applyOrder(next);
  }

  /** The room the next mark on the plan belongs to. */
  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null;

  /**
   * Selects a room, bringing its own floor forward when it is already
   * marked on a different one — so one room can never end up marked twice,
   * on two plans.
   */
  function select(area: SnaggingArea) {
    setActiveAreaId(area.id);
    if (area.floor_plan_id && area.floor_plan_id !== activePlanId) {
      setActivePlanId(area.floor_plan_id);
    }
  }

  /** Writes a placement — a pin, an outline, or the removal of both. */
  async function place(
    area: SnaggingArea,
    patch: {
      floor_plan_id: string | null;
      pin_x: number | null;
      pin_y: number | null;
      zone: ZonePoint[] | null;
    },
    success: string,
  ) {
    setBusy(true);
    setRunning("pin");
    try {
      await snaggingService.updateArea(taskId, { id: area.id, ...patch });
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the placement",
      );
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  function placePin(key: string, x: number, y: number) {
    const area = areas.find((a) => a.id === key);
    if (!area || !activePlanId) return;
    void place(
      area,
      { floor_plan_id: activePlanId, pin_x: x, pin_y: y, zone: null },
      `${area.name} pinned`,
    );
    // The room stays selected, so the mark you just made is the one the
    // list is still showing.
  }

  function placeZone(key: string, points: ZonePoint[]) {
    const area = areas.find((a) => a.id === key);
    if (!area || !activePlanId) return;
    // A zone implies a point, so the handset still has a fallback marker.
    const centre = zoneLabelPoint(points);
    void place(
      area,
      {
        floor_plan_id: activePlanId,
        pin_x: area.pin_x ?? centre.x,
        pin_y: area.pin_y ?? centre.y,
        zone: points,
      },
      `${area.name} drawn`,
    );
  }

  async function clearPlacement(area: SnaggingArea) {
    // The position is not recoverable — the plan has to be marked again.
    const ok = await confirm({
      title: `Take "${area.name}" off the plan?`,
      description:
        "The area stays on the job, but it will no longer be marked on any floor plan. You can mark it again by selecting it and clicking the plan.",
      confirmText: "Take off the plan",
      variant: "destructive",
    });
    if (!ok) return;

    await place(
      area,
      { floor_plan_id: null, pin_x: null, pin_y: null, zone: null },
      "Taken off the plan",
    );
  }

  /*
    The rooms a job of this shape normally has, offered as one tap each.

    Adding a room here meant typing its name, while creating the job had
    offered exactly the same list as a template — so the one place an area
    is most often MISSING was the one place the list was not available.
    Same source as the wizard, so a room added here carries the catalogue
    code too and the inspector's capture sheet offers the right elements
    in it.
  */
  const suggestions = useMemo(() => {
    const existing = new Set(areas.map((a) => a.name.trim().toLowerCase()));
    return templateFor(propertyType ?? "apartment", bedrooms ?? null).filter(
      (room) => !existing.has(room.name.toLowerCase()),
    );
  }, [areas, propertyType, bedrooms]);

  async function addSuggested(room: { name: string; code: string }) {
    setBusy(true);
    setRunning("area");
    try {
      const created = await snaggingService.createArea(taskId, {
        name: room.name,
        catalogue_area_code: room.code,
      });
      toast.success(`${room.name} added`);
      await load();
      setActiveAreaId(created.id);
      requestAnimationFrame(() => {
        areaListRef.current
          ?.querySelector(`[data-area-id="${created.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the area");
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function addAreaOnly() {
    const name = newAreaOnly.trim();
    if (!name) return;
    setBusy(true);
    setRunning("area");
    try {
      const created = await snaggingService.createArea(taskId, { name });
      setNewAreaOnly("");
      setAddAreaOpen(false);
      toast.success(`${name} added`);
      await load();
      // Selected and scrolled to, so it is ready to mark on the plan and
      // is not lost at the bottom of a list of twenty.
      setActiveAreaId(created.id);
      requestAnimationFrame(() => {
        areaListRef.current
          ?.querySelector(`[data-area-id="${created.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add the area",
      );
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function renameArea() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    setBusy(true);
    setRunning("rename");
    try {
      await snaggingService.updateArea(taskId, { id: renaming.id, name });
      setRenaming(null);
      toast.success("Area renamed");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not rename the area",
      );
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function removeArea(area: SnaggingArea) {
    // An area is not just a label: snags are recorded against it.
    const ok = await confirm({
      title: `Remove "${area.name}"?`,
      description:
        "The area and its pin are deleted. Any snag already recorded in this area loses the area it was logged against, and it cannot be undone from here.",
      confirmText: "Remove area",
      variant: "destructive",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await snaggingService.deleteArea(taskId, area.id);
      toast.success("Area removed");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the area",
      );
    } finally {
      setBusy(false);
    }
  }

  const planLabel = (id?: string | null) =>
    plans.find((p) => p.id === id)?.label ?? null;

  return (
    <SectionCard
      title="Floor plans & areas"
      icon={<Map />}
      description="One plan per floor (ordered), with each area pinned to its place"
      bodyClassName="border-t p-5"
    >
      <DataState
        loading={loading}
        error={error}
        onRetry={() => void load()}
        retrying={loading}
        errorTitle="Could not load floor plans and areas"
        // Mirrors the real two-column body: each side is a SubHeading
        // above a bordered list, and the left column carries the
        // Add-plan button underneath. Without those the heading and
        // button popped in and pushed the lists down on load.
        skeleton={
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Skeleton className="h-3 w-28" />
              <ListSkeleton rows={3} className="overflow-hidden rounded-lg border" />
              <Skeleton className="h-9 w-28 rounded-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-3 w-20" />
              <ListSkeleton rows={5} className="overflow-hidden rounded-lg border" />
            </div>
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: floors + the active plan with pins */}
          <div className="space-y-4">
            {/* Floor list with ordering */}
            <SubHeading
              count={plans.length}
              action={
                canEdit ? (
                  <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={busy}>
                    <Upload className="size-4" />
                    Add plan
                  </Button>
                ) : null
              }
            >
              Floor plans
            </SubHeading>
            <div className="overflow-hidden rounded-lg border">
              {plans.length === 0 ? (
                <EmptyState
                  icon={<Map />}
                  title="No floor plans yet"
                  description={
                    canEdit
                      ? "Add a plan per floor (PNG, JPG or PDF) to pin each area to its place on the unit."
                      : "No plan has been uploaded for this unit yet."
                  }
                  className="py-10"
                />
              ) : (
                <div className="divide-y">
                  {plans.map((plan, i) => {
                    const pins = areas.filter(
                      (a) => a.floor_plan_id === plan.id && a.pin_x != null,
                    ).length;
                    return (
                      <div
                        key={plan.id}
                        // The tint lives on the WRAPPER, not just the
                        // DataRow: the kebab sits outside the row, so a
                        // highlight on the row alone left a white strip at
                        // the right of the selected item.
                        draggable={canEdit && !busy}
                        onDragStart={() => setDragIndex(i)}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setOverIndex(null);
                        }}
                        onDragOver={(e) => {
                          if (dragIndex === null) return;
                          e.preventDefault();
                          setOverIndex(i);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null) void dropPlan(dragIndex, i);
                          setDragIndex(null);
                          setOverIndex(null);
                        }}
                        className={cn(
                          "flex items-center transition-colors",
                          plan.id === activePlanId && "bg-brand-100",
                          canEdit && !busy && "cursor-grab active:cursor-grabbing",
                          dragIndex === i && "opacity-50",
                          // A line where the row would land, rather than
                          // guessing from a floating ghost.
                          overIndex === i && dragIndex !== i && "border-t-brand border-t-2",
                        )}
                      >
                        <DataRow
                          className="flex-1 py-2.5"
                          active={plan.id === activePlanId}
                          onClick={() => setActivePlanId(plan.id)}
                          icon={
                            <span className="text-xs font-semibold tabular-nums">
                              {i + 1}
                            </span>
                          }
                          title={plan.label}
                          subtitle={
                            pins === 1
                              ? "1 area pinned"
                              : `${pins} areas pinned`
                          }
                        />
                        {/*
                          One menu rather than three inline icon buttons.
                          A row of bare icons reads as decoration until you
                          hover each one, and the destructive action sat
                          two pixels from "move down".
                        */}
                        {canEdit ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="mr-3 shrink-0"
                                disabled={busy}
                                aria-label={`Actions for ${plan.label}`}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={i === 0}
                                onClick={() => void move(i, -1)}
                              >
                                <ArrowUp className="size-4" />
                                Move up
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={i === plans.length - 1}
                                onClick={() => void move(i, 1)}
                              >
                                <ArrowDown className="size-4" />
                                Move down
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => void removePlan(plan)}
                              >
                                <Trash2 className="size-4" />
                                Remove plan
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active plan: pins and outlines */}
            {activePlan?.signed_url ? (
              <div className="space-y-2">
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Pin or outline — the same choice the job wizard
                        offers, so the two screens teach one gesture. */}
                    <div className="bg-muted inline-flex rounded-md p-0.5">
                      {(["pin", "zone"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPlaceMode(option)}
                          aria-pressed={placeMode === option}
                          className={cn(
                            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                            placeMode === option
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {option === "pin" ? "Drop a pin" : "Draw the room"}
                        </button>
                      ))}
                    </div>

                    {activeArea ? (
                      <p className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
                        <span className="text-brand font-medium">
                          Placing {activeArea.name}
                        </span>
                        <span>
                          {placeMode === "pin"
                            ? "— click the plan."
                            : "— click each corner, then Enter to close it. Backspace undoes a corner, Esc starts over."}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveAreaId(null)}
                          className="hover:text-foreground underline underline-offset-2"
                        >
                          Done
                        </button>
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Pick a room in the list to mark it on the plan.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Areas marked on this floor.
                  </p>
                )}

                <PlanZoneCanvas
                  src={activePlan.signed_url}
                  alt={activePlan.label}
                  mode={placeMode}
                  readOnly={!canEdit || busy}
                  activeKey={activeArea ? activeArea.id : null}
                  areas={areas
                    .filter((a) => a.floor_plan_id === activePlan.id)
                    .map((a) => ({
                      key: a.id,
                      name: a.name,
                      pinX: a.pin_x ?? null,
                      pinY: a.pin_y ?? null,
                      zone: a.zone ?? null,
                    }))}
                  onPlacePin={placePin}
                  onPlaceZone={placeZone}
                  onPickArea={(key) => {
                    const hit = areas.find((a) => a.id === key);
                    if (hit) setActiveAreaId(hit.id);
                  }}
                />
              </div>
            ) : activePlan ? (
              <EmptyState
                icon={<ImageOff />}
                title="No preview for this plan"
                description="The file uploaded for this floor could not be rendered, so areas cannot be pinned on it. Replace the plan with a PNG, JPG or PDF."
                className="rounded-lg border border-dashed py-10"
              />
            ) : null}
          </div>

          {/*
            Right: the rooms.

            Out of flow on a wide screen so the PLAN sets the row height —
            a job with twenty rooms used to stretch the row well past the
            bottom of the plan beside it.
          */}
          <div className="relative">
            <div className="flex flex-col gap-3 lg:absolute lg:inset-0">
              <SubHeading
                count={areas.length}
                action={
                  canEdit ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => setAddAreaOpen(true)}
                      disabled={busy}
                      aria-label="Add an area"
                      title="Add an area"
                    >
                      <Plus className="size-4" />
                    </Button>
                  ) : null
                }
              >
                Areas
              </SubHeading>

              <div
                ref={areaListRef}
                className="max-h-[26rem] min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 lg:max-h-none"
              >
                {areas.length === 0 ? (
                  <EmptyState
                    icon={<MapPin className="size-6" />}
                    title="No areas yet"
                    description={
                      canEdit
                        ? "Add the rooms this job covers, then mark each one on the floor plan."
                        : "Areas appear here once the inspector sets them up."
                    }
                    className="rounded-lg border border-dashed py-10"
                  />
                ) : null}

                {areas.map((a) => {
                  const drawn = Boolean(a.zone);
                  const placed = a.pin_x != null || drawn;
                  const isActive = a.id === activeAreaId;
                  const elsewhere =
                    placed && a.floor_plan_id && a.floor_plan_id !== activePlanId;
                  return (
                    <div
                      key={a.id}
                      data-area-id={a.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-2 text-sm transition-colors",
                        isActive
                          ? "border-brand/40 bg-brand-50/40 ring-brand/60 ring-2"
                          : "border-border",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => select(a)}
                        disabled={!canEdit}
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                      >
                        <span
                          className={cn(
                            "block truncate",
                            placed && "text-brand font-medium",
                          )}
                        >
                          {a.name}
                        </span>
                        {elsewhere ? (
                          <span className="text-muted-foreground block truncate text-xs">
                            on {planLabel(a.floor_plan_id)}
                          </span>
                        ) : null}
                      </button>

                      {canEdit ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          {/* The room's state, as the control that changes
                              it: a marker when it is on a plan, a target
                              when it is not. */}
                          <button
                            type="button"
                            disabled={busy || plans.length === 0}
                            onClick={() => select(a)}
                            aria-label={
                              placed
                                ? `${a.name} is on the plan. Select it to place it again.`
                                : `Place ${a.name} on the plan`
                            }
                            title={
                              placed
                                ? drawn
                                  ? "Drawn as a room. Select to place again."
                                  : "Pinned. Select to place again."
                                : "Place on the plan"
                            }
                            className={cn(
                              "hover:bg-brand/10 rounded p-1 transition-colors disabled:opacity-40",
                              placed ? "text-brand" : "text-muted-foreground",
                            )}
                          >
                            {drawn ? (
                              <Shapes className="size-3.5" />
                            ) : placed ? (
                              <MapPin className="size-3.5" />
                            ) : (
                              <Crosshair className="size-3.5" />
                            )}
                          </button>

                          {placed ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void clearPlacement(a)}
                              title="Take off the plan"
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-1 transition-colors"
                            >
                              <Eraser className="size-3.5" />
                            </button>
                          ) : null}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRenaming({ id: a.id, name: a.name })}
                            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1 transition-colors"
                            title="Rename"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeArea(a)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-1 transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {canEdit && suggestions.length > 0 ? (
                <div className="shrink-0">
                  <p className="text-muted-foreground mb-2 text-xs">
                    Rooms this property usually has. Tap to add.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((room) => (
                      <button
                        key={room.name}
                        type="button"
                        onClick={() => void addSuggested(room)}
                        disabled={busy}
                        className="border-input hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <Plus className="size-3" aria-hidden />
                        {room.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DataState>

      {/* Add an area, from the + beside the Areas heading */}
      <Dialog
        open={addAreaOpen}
        onOpenChange={(open) => {
          setAddAreaOpen(open);
          if (!open) setNewAreaOnly("");
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add an area</DialogTitle>
            <DialogDescription>
              A room this job covers. It is selected as soon as it is added,
              so you can mark it on the plan straight away.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-job-area">Name</Label>
            <Input
              id="new-job-area"
              autoFocus
              value={newAreaOnly}
              onChange={(e) => setNewAreaOnly(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addAreaOnly();
                }
              }}
              placeholder="e.g. Roof terrace"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddAreaOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void addAreaOnly()}
              disabled={busy || !newAreaOnly.trim()}
              pending={running === "area"}
              pendingLabel="Adding…"
              icon={<Plus className="size-4" />}
            >
              Add area
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename area */}
      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename area</DialogTitle>
            <DialogDescription>
              The new name is used everywhere this area appears: its pin, the
              snags recorded in it, and the report.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renaming?.name ?? ""}
            onChange={(e) =>
              setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void renameArea();
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenaming(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void renameArea()}
              disabled={busy || !renaming?.name.trim()}
              pending={running === "rename"}
              pendingLabel="Saving…"
            >
              Save
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddFloorPlanDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        pending={running === "upload"}
        onSubmit={(planLabel, file) => upload(planLabel, file)}
      />

      {dialog}
    </SectionCard>
  );
}
