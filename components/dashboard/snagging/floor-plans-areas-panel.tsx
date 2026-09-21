"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  X,
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
import MultipleSelector, { type Option } from "@/components/ui/multiselect";
import AddFloorPlanDialog from "./add-floor-plan-dialog";
import { PlanZoneCanvas } from "./plan-zone-canvas";
import { zoneLabelPoint, type ZonePoint } from "@/lib/snagging/zone-geometry";

import {
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
  onChanged,
}: {
  taskId: string;
  /**
   * Called after anything here changes the job's rooms or plans. The page
   * re-reads the job, so the Areas count, the snag list's pins and the
   * "Areas walked" card follow -- they used to keep the old rooms until
   * the page was reloaded.
   */
  onChanged?: () => void;
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
  type Running = null | "upload" | "pin" | "area" | "rename" | "plan" | "order";
  const [running, setRunning] = useState<Running>(null);
  const [addOpen, setAddOpen] = useState(false);
  /* Renaming happens on the chip itself, so only its id and its text. */
  const [renamingPlan, setRenamingPlan] = useState<{
    id: string;
    label: string;
  } | null>(null);
  /* A file is being dragged over the plan column. */
  const [dropping, setDropping] = useState(false);
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
  /*
    The rooms the add dialog is holding.

    One list rather than a ticked set plus a separate text field: the
    selector is creatable, so a room the template does not have is typed
    into the same control and arrives here as an option like any other.
    Several at once because the common case is a new job needing eight
    rooms, and adding them one at a time meant eight round trips with the
    list shifting under the finger between each.
  */
  const [chosen, setChosen] = useState<Option[]>([]);
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

  /**
   * Runs one action behind a toast that says what is happening, then what
   * happened — the same toast, updated in place.
   *
   * Everything on this panel talks to the server and several are slow
   * enough to look broken: a PDF plan is rasterised and re-encoded before
   * it uploads, and adding eight rooms is eight round trips. Announcing
   * only the result left those seconds silent, so people clicked again.
   *
   * `running` drives which button spins; `busy` disables the rest. Both
   * are set here so no caller can forget to clear them.
   */
  async function act<T>(
    key: Exclude<Running, null>,
    labels: { loading: string; done: string | ((result: T) => string); failed: string },
    work: () => Promise<T>,
    options: { reloadOnError?: boolean } = {},
  ): Promise<T | null> {
    setBusy(true);
    setRunning(key);
    const id = toast.loading(labels.loading);
    try {
      const result = await work();
      toast.success(
        typeof labels.done === "function" ? labels.done(result) : labels.done,
        { id },
      );
      await load();
      onChanged?.();
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : labels.failed, { id });
      // A failed reorder left the optimistic order on screen, so the list
      // disagreed with the server until something else refreshed it.
      if (options.reloadOnError) await load();
      return null;
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function upload(planLabel: string, file: File) {
    const isPdf = file.type === "application/pdf";
    await act(
      "upload",
      {
        // A PDF is rendered to an image before it uploads, which is the
        // slowest thing this panel does — so it says which stage it is at.
        loading: isPdf ? "Converting the PDF…" : "Uploading the plan…",
        done: isPdf ? "PDF converted and added" : "Floor plan added",
        failed: "Could not upload the plan",
      },
      async () => {
        const prepared = await toPinnablePlan(file);
        await snaggingService.uploadFloorPlan(taskId, prepared.file, {
          // The dialog requires a label, so there is no "Floor N"
          // fallback producing plans nobody can tell apart.
          label: planLabel,
          width: prepared.width,
          height: prepared.height,
        });
        setAddOpen(false);
      },
    );
  }

  /**
   * A plan dropped straight onto the column.
   *
   * Named from the file, because the dialog's one job is to ask for a
   * label and a file that arrived by hand has already given both — the
   * name it was saved under is what the person dragging it calls that
   * floor. It can be renamed on the chip in a double-click if it is not.
   */
  async function dropUpload(file: File) {
    const named = file.name.replace(/\.[^.]+$/, "").trim();
    await upload(named || `Floor ${plans.length + 1}`, file);
  }

  async function renamePlan(id: string, label: string) {
    const next = label.trim();
    const current = plans.find((p) => p.id === id);
    setRenamingPlan(null);
    if (!next || !current || next === current.label) return;

    await act(
      "plan",
      {
        loading: "Renaming the plan…",
        done: "Floor plan renamed",
        failed: "Could not rename the plan",
      },
      () => snaggingService.renameFloorPlan(id, next),
    );
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

    await act(
      "plan",
      {
        loading: `Removing ${plan.label}…`,
        done: "Floor plan removed",
        failed: "Could not remove the plan",
      },
      async () => {
        await snaggingService.deleteFloorPlan(plan.id);
        if (activePlanId === plan.id) setActivePlanId(null);
      },
    );
  }

  // Both the Move up/down menu items and drag-and-drop end here, so the
  // optimistic update and its rollback exist in one place.
  async function applyOrder(next: SnaggingFloorPlan[]) {
    setPlans(next);
    await act(
      "order",
      {
        loading: "Saving the floor order…",
        done: "Floor order updated",
        failed: "Could not reorder",
      },
      () => snaggingService.reorderFloorPlans(next.map((p) => p.id)),
      // The optimistic order above has to be undone if the save failed.
      { reloadOnError: true },
    );
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
    labels: { loading: string; done: string },
  ) {
    await act(
      "pin",
      { ...labels, failed: "Could not save the placement" },
      () => snaggingService.updateArea(taskId, { id: area.id, ...patch }),
    );
  }

  function placePin(key: string, x: number, y: number) {
    const area = areas.find((a) => a.id === key);
    if (!area || !activePlanId) return;
    void place(
      area,
      { floor_plan_id: activePlanId, pin_x: x, pin_y: y, zone: null },
      { loading: `Pinning ${area.name}…`, done: `${area.name} pinned` },
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
      { loading: `Saving ${area.name}…`, done: `${area.name} drawn` },
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
      {
        loading: `Taking ${area.name} off the plan…`,
        done: "Taken off the plan",
      },
    );
  }

  /*
    The rooms a job of this shape normally has, offered in the add dialog.

    Same source as the wizard, so a room added here carries the catalogue
    code too and the inspector's capture sheet offers the right elements
    in it. Anything already on the job is filtered out, so the list only
    ever offers what is missing.
  */
  const suggestions = useMemo(() => {
    const existing = new Set(areas.map((a) => a.name.trim().toLowerCase()));
    return templateFor(propertyType ?? "apartment", bedrooms ?? null).filter(
      (room) => !existing.has(room.name.toLowerCase()),
    );
  }, [areas, propertyType, bedrooms]);

  /**
   * Adds everything the dialog is holding: the ticked suggestions, and a
   * typed name if there is one.
   *
   * Written as one pass so the panel reloads once at the end rather than
   * after each room, and so a failure part way through still leaves the
   * rooms that did land.
   */
  async function addPickedAreas() {
    const rooms = chosen
      .map((option) => option.label.trim())
      .filter((name) => name.length > 0);
    if (rooms.length === 0) return;

    /*
      A room from the template carries its catalogue code, so the
      inspector's capture sheet offers the right elements in it. One
      typed by hand has no code and falls back to the whole catalogue —
      which is the honest answer for a room nobody has classified.
    */
    /*
      A record, not a Map: this file imports `Map` from lucide-react for
      the section icon, so `new Map()` resolves to the icon component.
    */
    const codeFor: Record<string, string> = {};
    for (const room of suggestions) codeFor[room.name.toLowerCase()] = room.code;

    setBusy(true);
    setRunning("area");
    /*
      One toast for the whole batch, counting up as it goes.

      Each room is its own request, so adding eight is eight round trips
      — long enough that a silent dialog looks stuck. The toast is
      updated per room rather than replaced, so the screen never stacks
      eight of them.
    */
    const id = toast.loading(
      rooms.length === 1 ? `Adding ${rooms[0]}…` : `Adding 0 of ${rooms.length} areas…`,
    );
    let last: { id: string } | null = null;
    let failed = 0;
    try {
      for (const [index, name] of rooms.entries()) {
        if (rooms.length > 1) {
          toast.loading(`Adding ${index + 1} of ${rooms.length} areas…`, { id });
        }
        try {
          const code = codeFor[name.toLowerCase()];
          last = await snaggingService.createArea(taskId, {
            name,
            ...(code ? { catalogue_area_code: code } : {}),
          });
        } catch {
          failed += 1;
        }
      }

      const added = rooms.length - failed;
      if (failed === 0) {
        toast.success(added === 1 ? "Area added" : `${added} areas added`, { id });
      } else if (added === 0) {
        toast.error(
          rooms.length === 1 ? "That area could not be added" : "No areas could be added",
          { id },
        );
      } else {
        // Partly through is its own outcome: some rooms ARE on the job now.
        toast.warning(`${added} added, ${failed} could not be`, { id });
      }

      setChosen([]);
      setAddAreaOpen(false);
      await load();
      onChanged?.();

      /*
        The last one added is selected and shown, so a single addition is
        ready to mark on the plan straight away. Adding eight leaves the
        eighth active, which is as good a starting point as any.
      */
      const lastId = last?.id;
      if (lastId) {
        setActiveAreaId(lastId);
        requestAnimationFrame(() => {
          areaListRef.current
            ?.querySelector(`[data-area-id="${lastId}"]`)
            ?.scrollIntoView({ block: "nearest" });
        });
      }
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function renameArea() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    const ok = await act(
      "rename",
      {
        loading: `Renaming to ${name}…`,
        done: "Area renamed",
        failed: "Could not rename the area",
      },
      () => snaggingService.updateArea(taskId, { id: renaming.id, name }),
    );
    if (ok !== null) setRenaming(null);
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

    await act(
      "area",
      {
        loading: `Removing ${area.name}…`,
        done: "Area removed",
        failed: "Could not remove the area",
      },
      () => snaggingService.deleteArea(taskId, area.id),
    );
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
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: floors + the active plan with pins */}
          {/*
            The whole column is a drop target.

            A plan arrives as a file somebody already has open; making them
            find a button, then a dialog, then a file picker for it is
            three steps to do what dropping it does in one. The dialog
            stays for the click route and for naming as you add.
          */}
          <div
            className={cn(
              "space-y-4 rounded-lg transition-colors col-span-2",
              dropping && "ring-brand bg-brand-50/30 ring-2 ring-offset-4",
            )}
            onDragOver={(event) => {
              // Files only. A chip being dragged to reorder passes over
              // this same element and must not light it up.
              if (!canEdit || busy) return;
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropping(true);
            }}
            onDragLeave={(event) => {
              // Only when the pointer actually leaves the column, not on
              // every child it crosses on the way in.
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDropping(false);
            }}
            onDrop={(event) => {
              if (!canEdit || busy) return;
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDropping(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void dropUpload(file);
            }}
          >
            {plans.length === 0 ? (
              <EmptyState
                icon={<Map />}
                title="No floor plans yet"
                description={
                  canEdit
                    ? "Drop a plan here, or add one per floor (PNG, JPG or PDF), to pin each area to its place."
                    : "No plan has been uploaded for this unit yet."
                }
                className="rounded-lg border border-dashed py-10"
                action={
                  canEdit
                    ? {
                      label: "Add plan",
                      onClick: () => setAddOpen(true),
                      variant: "outline",
                    }
                    : undefined
                }
              />
            ) : (
              <>
                {/*
                  One chip per floor, the shape the job wizard uses.

                  A bordered list with a number, a subtitle and a kebab
                  spent a third of the column on two or three plans, and
                  pushed the drawing — the thing this panel is actually
                  about — below the fold.
                */}
                <div className="flex flex-wrap items-center gap-2">
                  {plans.map((plan, i) => {
                    const pins = areas.filter(
                      (a) => a.floor_plan_id === plan.id && a.pin_x != null,
                    ).length;
                    const active = plan.id === activePlanId;

                    if (renamingPlan?.id === plan.id) {
                      return (
                        <Input
                          key={plan.id}
                          autoFocus
                          value={renamingPlan.label}
                          className="h-8 w-44 rounded-full text-xs"
                          aria-label={`Rename ${plan.label}`}
                          onChange={(event) =>
                            setRenamingPlan({
                              id: plan.id,
                              label: event.target.value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void renamePlan(plan.id, renamingPlan.label);
                            }
                            if (event.key === "Escape") setRenamingPlan(null);
                          }}
                          onBlur={() => void renamePlan(plan.id, renamingPlan.label)}
                        />
                      );
                    }

                    return (
                      <span
                        key={plan.id}
                        draggable={canEdit && !busy}
                        onDragStart={() => setDragIndex(i)}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setOverIndex(null);
                        }}
                        onDragOver={(event) => {
                          if (dragIndex === null) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setOverIndex(i);
                        }}
                        onDrop={(event) => {
                          if (dragIndex === null) return;
                          event.preventDefault();
                          event.stopPropagation();
                          void dropPlan(dragIndex, i);
                          setDragIndex(null);
                          setOverIndex(null);
                        }}
                        className={cn(
                          "inline-flex items-center rounded-full border text-xs font-medium transition-colors",
                          active
                            ? "border-brand bg-brand-50 text-brand"
                            : "border-border hover:bg-mist-soft",
                          canEdit && !busy && "cursor-grab active:cursor-grabbing",
                          dragIndex === i && "opacity-50",
                          overIndex === i &&
                          dragIndex !== i &&
                          "ring-brand/50 ring-2",
                        )}
                      >
                        <button
                          type="button"
                          className="py-1 pl-3 pr-2"
                          onClick={() => setActivePlanId(plan.id)}
                          onDoubleClick={() => {
                            if (!canEdit || busy) return;
                            setRenamingPlan({ id: plan.id, label: plan.label });
                          }}
                          onKeyDown={(event) => {
                            if (!canEdit || busy) return;
                            // Reordering has to be reachable without a
                            // mouse; dragging never is.
                            if (event.key === "ArrowLeft" && event.ctrlKey) {
                              event.preventDefault();
                              void move(i, -1);
                            }
                            if (event.key === "ArrowRight" && event.ctrlKey) {
                              event.preventDefault();
                              void move(i, 1);
                            }
                            if (event.key === "F2") {
                              event.preventDefault();
                              setRenamingPlan({ id: plan.id, label: plan.label });
                            }
                          }}
                          title={
                            canEdit
                              ? "Double-click to rename · drag to reorder"
                              : plan.label
                          }
                        >
                          {plan.label.trim() || "Untitled plan"}
                          {pins > 0 ? (
                            <span className="ml-1.5 opacity-60 tabular-nums">
                              {pins}
                            </span>
                          ) : null}
                        </button>

                        {/*
                          Removal on the chip rather than behind a menu,
                          and only on the one you are looking at — a row
                          of crosses invites the wrong one to be clicked.
                        */}
                        {canEdit && active ? (
                          <button
                            type="button"
                            className="hover:text-destructive rounded-full py-1 pl-0.5 pr-2.5 opacity-70 transition-opacity hover:opacity-100"
                            disabled={busy}
                            aria-label={`Remove ${plan.label}`}
                            onClick={() => void removePlan(plan)}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : (
                          <span className="pr-1.5" />
                        )}
                      </span>
                    );
                  })}

                  {canEdit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddOpen(true)}
                      disabled={busy}
                    >
                      <Plus className="size-4" />
                      Add plan
                    </Button>
                  ) : null}
                </div>

                {/* The two gestures on the chips, said once. */}
                {/* {canEdit ? (
                  <p className="text-muted-foreground text-xs">
                    Double-click a plan to rename it
                    {plans.length > 1 ? ", drag to reorder" : ""}. Drop an image
                    here to add another.
                  </p>
                ) : null} */}
              </>
            )}

            {/* Active plan: pins and outlines */}
            {activePlan?.signed_url ? (
              <div className="space-y-2">
                {/*
                  One strip above the plan: what a click will do on the
                  left, what it will do it to on the right.

                  These were two competing lines — a toggle, then a
                  sentence in brand red running the width of the column
                  with "Done" buried at the end of it. The instruction is
                  the quiet half; the room being placed is the half worth
                  seeing, so it is a chip rather than prose.
                */}
                {canEdit ? (
                  <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-1.5">
                    <div className="bg-background inline-flex rounded-md border p-0.5">
                      {(["pin", "zone"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPlaceMode(option)}
                          aria-pressed={placeMode === option}
                          className={cn(
                            "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                            placeMode === option
                              ? "bg-brand-50 text-brand"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {option === "pin" ? (
                            <MapPin className="size-3.5" />
                          ) : (
                            <Shapes className="size-3.5" />
                          )}
                          {option === "pin" ? "Drop a pin" : "Draw the room"}
                        </button>
                      ))}
                    </div>

                    {activeArea ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="bg-brand text-primary-foreground inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-medium">
                          <Crosshair className="size-3 shrink-0" />
                          <span className="truncate">{activeArea.name}</span>
                        </span>
                        <span className="text-muted-foreground hidden text-xs sm:inline">
                          {placeMode === "pin"
                            ? "Click the plan"
                            : "Click each corner · Enter closes · Esc restarts"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setActiveAreaId(null)}
                        >
                          Done
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Pick a room to mark it
                      </span>
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
          <div className="relative col-span-1">
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
                  const Marker = drawn ? Shapes : placed ? MapPin : Crosshair;
                  /*
                    Where the room is, in words.

                    The state used to live only in which of four icons was
                    lit, so telling "pinned" from "not placed" meant
                    hovering each row in turn. A line of muted text under
                    the name reads at a glance and says WHICH floor when
                    there is more than one.
                  */
                  const state = !placed
                    ? "Not on the plan"
                    : elsewhere
                      ? `${drawn ? "Drawn" : "Pinned"} on ${planLabel(a.floor_plan_id)}`
                      : drawn
                        ? "Drawn as a room"
                        : "Pinned";
                  return (
                    <div
                      key={a.id}
                      data-area-id={a.id}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors",
                        // A quiet selected state: the ring-2 plus tint was
                        // shouting next to a plan it is only annotating.
                        isActive
                          ? "border-brand bg-brand-50/50"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => select(a)}
                        disabled={!canEdit}
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                      >
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {state}
                        </span>
                      </button>

                      {/*
                        The marker sits at the end, beside the row's menu,
                        so it lines up down the list and the names all
                        start at the same x. It reads rather than acts —
                        selecting the row is what the row itself does.
                      */}
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md border [&_svg]:size-3.5",
                          placed
                            ? "border-brand/30 bg-brand-50 text-brand"
                            : "text-muted-foreground bg-muted/50",
                        )}
                        title={state}
                      >
                        <Marker />
                      </span>

                      {/*
                        One menu, not four icons.

                        Four bare icons per row is sixteen on a job with
                        four areas, and the destructive one sat two pixels
                        from the one that only renames. Placing stays on
                        the row itself because it is the common act; the
                        rest are occasional and belong behind a menu.
                      */}
                      {canEdit ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              disabled={busy}
                              aria-label={`Actions for ${a.name}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={plans.length === 0}
                              onClick={() => select(a)}
                            >
                              <Crosshair className="size-4" />
                              {placed ? "Place again" : "Place on the plan"}
                            </DropdownMenuItem>
                            {placed ? (
                              <DropdownMenuItem onClick={() => void clearPlacement(a)}>
                                <Eraser className="size-4" />
                                Take off the plan
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() => setRenaming({ id: a.id, name: a.name })}
                            >
                              <Pencil className="size-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => void removeArea(a)}
                            >
                              <Trash2 className="size-4" />
                              Remove area
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </DataState>

      {/* Add an area, from the + beside the Areas heading */}
      <Dialog
        open={addAreaOpen}
        onOpenChange={(open) => {
          setAddAreaOpen(open);
          if (!open) setChosen([]);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          /*
            Nothing is focused when this opens.

            Radix focuses the first control it finds, which here is the
            room search — and that control opens its suggestion list on
            focus. The dialog therefore appeared with a list already up,
            covering its own title before anybody had asked for a room.
          */
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add areas</DialogTitle>
            <DialogDescription>
              Pick the rooms this job covers, or type one the list does not
              have. They are added together.
            </DialogDescription>
          </DialogHeader>

          {/*
            One searchable control, not a wall of chips.

            The template can offer thirty rooms, and laid out as chips
            they filled the dialog and still had to be read one by one to
            find "Bathroom 6". A selector searches, and because it is
            creatable the room the template does NOT have is typed into
            the same box rather than a second field underneath it.
          */}
          <div className="space-y-1.5">
            <Label>Rooms</Label>
            <MultipleSelector
              value={chosen}
              onChange={setChosen}
              options={suggestions.map((room) => ({
                value: room.name,
                label: room.name,
              }))}
              creatable
              hidePlaceholderWhenSelected
              placeholder="Search the usual rooms, or type one of your own…"
              emptyIndicator={
                <span className="text-muted-foreground text-sm">
                  {suggestions.length === 0
                    ? "Every room this property usually has is already on the job."
                    : "No match. Keep typing to add it as a new room."}
                </span>
              }
            />
            {/* <p className="text-muted-foreground text-xs">
              A room from the list carries its catalogue code, so the
              inspector is offered the right elements in it.
            </p> */}
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
              onClick={() => void addPickedAreas()}
              disabled={busy || chosen.length === 0}
              pending={running === "area"}
              pendingLabel="Adding…"
              icon={<Plus className="size-4" />}
            >
              {chosen.length > 1 ? `Add ${chosen.length} areas` : "Add area"}
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
