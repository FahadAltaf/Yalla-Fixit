"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImageOff,
  Map,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingArea,
  type SnaggingFloorPlan,
} from "@/types/types";

import { EmptyState } from "@/components/ui/empty-state";

import {
  DataRow,
  DataState,
  ListSkeleton,
  SectionCard,
  SubHeading,
  SubmitButton,
  useConfirm,
} from "./shared";

const NEW_AREA = "__new__";

/**
 * Prepares a file for upload. Images pass through with their natural size read.
 * A PDF is rendered (page 1) to a PNG so the plan is pinnable everywhere —
 * never silently stored as a non-viewable PDF (FR-3.05 #7).
 */
async function toPinnablePlan(
  file: File,
): Promise<{ file: File; width?: number; height?: number }> {
  if (file.type.startsWith("image/")) {
    const size = await new Promise<{ width?: number; height?: number }>(
      (resolve) => {
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          resolve({});
          URL.revokeObjectURL(url);
        };
        img.src = url;
      },
    );
    return { file, ...size };
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
    const png = new File([blob], file.name.replace(/\.pdf$/i, ".png"), {
      type: "image/png",
    });
    return { file: png, width: canvas.width, height: canvas.height };
  }

  throw new Error("Floor plans must be an image (PNG/JPG) or a PDF");
}

export function FloorPlansAreasPanel({ taskId }: { taskId: string }) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );
  const { confirm, dialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);

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
  const [label, setLabel] = useState("");
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  // Pending pin (a click position awaiting an area choice).
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [pinAreaChoice, setPinAreaChoice] = useState<string>(NEW_AREA);
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaOnly, setNewAreaOnly] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
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
  const pinnedHere = areas.filter(
    (a) => a.floor_plan_id === activePlanId && a.pin_x != null,
  );
  const unpinnedAreas = areas.filter(
    (a) => a.pin_x == null || a.floor_plan_id == null,
  );

  async function upload(file: File) {
    setBusy(true);
    setRunning("upload");
    try {
      const prepared = await toPinnablePlan(file);
      await snaggingService.uploadFloorPlan(taskId, prepared.file, {
        label: label.trim() || `Floor ${plans.length + 1}`,
        width: prepared.width,
        height: prepared.height,
      });
      setLabel("");
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
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePlan(plan: SnaggingFloorPlan) {
    // The file is deleted outright, and every pin placed on it is left
    // without a plan to sit on.
    const ok = await confirm({
      title: `Remove “${plan.label}”?`,
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

  async function move(index: number, dir: -1 | 1) {
    const next = [...plans];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
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

  function onPlanClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!canEdit || !imgWrapRef.current) return;
    const rect = imgWrapRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setPinAreaChoice(NEW_AREA);
    setNewAreaName("");
    setPending({ x, y });
  }

  async function confirmPin() {
    if (!pending || !activePlanId) return;
    setBusy(true);
    setRunning("pin");
    try {
      if (pinAreaChoice === NEW_AREA) {
        const name = newAreaName.trim();
        if (!name) {
          toast.error("Name the area this pin represents");
          setBusy(false);
          setRunning(null);
          return;
        }
        await snaggingService.createArea(taskId, {
          name,
          floor_plan_id: activePlanId,
          pin_x: pending.x,
          pin_y: pending.y,
        });
      } else {
        await snaggingService.updateArea(taskId, {
          id: pinAreaChoice,
          floor_plan_id: activePlanId,
          pin_x: pending.x,
          pin_y: pending.y,
        });
      }
      toast.success("Pin placed");
      setPending(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not place the pin",
      );
    } finally {
      setBusy(false);
      setRunning(null);
    }
  }

  async function clearPin(area: SnaggingArea) {
    // The position is not recoverable — the plan has to be clicked again.
    const ok = await confirm({
      title: `Remove the pin for “${area.name}”?`,
      description:
        "The area stays on the job, but it will no longer be marked on any floor plan. You can pin it again by clicking the plan.",
      confirmText: "Remove pin",
      variant: "destructive",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await snaggingService.updateArea(taskId, {
        id: area.id,
        floor_plan_id: null,
        pin_x: null,
        pin_y: null,
      });
      toast.success("Pin removed");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the pin",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addAreaOnly() {
    const name = newAreaOnly.trim();
    if (!name) return;
    setBusy(true);
    setRunning("area");
    try {
      await snaggingService.createArea(taskId, { name });
      setNewAreaOnly("");
      toast.success("Area added");
      await load();
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
      title: `Remove “${area.name}”?`,
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
        // Two bordered columns, so the plan list and the area list do not
        // jump into place when the fetch lands.
        skeleton={
          <div className="grid gap-6 lg:grid-cols-2">
            <ListSkeleton
              rows={3}
              className="overflow-hidden rounded-lg border"
            />
            <ListSkeleton
              rows={5}
              className="overflow-hidden rounded-lg border"
            />
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: floors + the active plan with pins */}
          <div className="space-y-4">
            {/* Floor list with ordering */}
            <SubHeading count={plans.length}>Floor plans</SubHeading>
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
                      <div key={plan.id} className="flex items-center">
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

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. Ground floor)"
                  className="max-w-48"
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                {/* A PDF is rasterised in the browser, which is slow enough
                    that the button has to say it is working. */}
                <SubmitButton
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  pending={running === "upload"}
                  pendingLabel="Processing…"
                  icon={<Upload className="size-4" />}
                >
                  Add plan
                </SubmitButton>
              </div>
            ) : null}

            {/* Active plan with pins */}
            {activePlan?.signed_url ? (
              <div className="space-y-2">
                {/* An instruction, not a label — SubHeading uppercases,
                    and shouting a hint at the reader is not the same as
                    naming the block it sits above. */}
                <p className="text-muted-foreground text-xs">
                  {canEdit
                    ? "Click the plan to place a pin for an area."
                    : "Area pins on this floor."}
                </p>
                <div
                  ref={imgWrapRef}
                  onClick={onPlanClick}
                  className={`relative w-full overflow-hidden rounded-lg border bg-muted ${canEdit ? "cursor-crosshair" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activePlan.signed_url}
                    alt={activePlan.label}
                    className="block w-full select-none"
                    draggable={false}
                  />
                  {pinnedHere.map((a, idx) => (
                    <span
                      key={a.id}
                      className="bg-brand ring-background absolute flex size-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full text-[10px] font-bold text-white ring-2"
                      style={{
                        left: `${(a.pin_x ?? 0) * 100}%`,
                        top: `${(a.pin_y ?? 0) * 100}%`,
                      }}
                      title={a.name}
                    >
                      {idx + 1}
                    </span>
                  ))}
                </div>
                {pinnedHere.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {pinnedHere.map((a, idx) => (
                      <Badge
                        key={a.id}
                        variant="secondary"
                        className="gap-1.5 font-normal"
                      >
                        <span className="text-brand font-semibold tabular-nums">
                          {idx + 1}
                        </span>
                        {a.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
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

          {/* Right: area list */}
          <div className="space-y-3">
            <SubHeading count={areas.length}>Areas</SubHeading>
            <div className="space-y-1">
              {areas.length === 0 ? (
                <EmptyState
                  icon={<MapPin className="size-6" />}
                  title="No areas yet"
                  description={
                    canEdit
                      ? "Add areas below, or click a floor plan to create one where you drop the pin."
                      : "Areas appear here once the inspector sets them up."
                  }
                  className="rounded-lg border border-dashed py-10"
                />
              ) : null}
              {areas.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  {a.pin_x != null ? (
                    <MapPin className="size-4 text-red-600" />
                  ) : (
                    <MapPin className="text-muted-foreground/40 size-4" />
                  )}
                  <span className="flex-1 truncate">{a.name}</span>
                  {a.floor_plan_id ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {planLabel(a.floor_plan_id)}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <>
                      {a.pin_x != null ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void clearPin(a)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Remove pin"
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRenaming({ id: a.id, name: a.name })}
                        className="text-muted-foreground hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeArea(a)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newAreaOnly}
                  onChange={(e) => setNewAreaOnly(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addAreaOnly();
                    }
                  }}
                  placeholder="Add an area (e.g. Balcony)"
                />
                <SubmitButton
                  variant="outline"
                  size="sm"
                  onClick={() => void addAreaOnly()}
                  disabled={busy || !newAreaOnly.trim()}
                  pending={running === "area"}
                  pendingLabel="Adding…"
                  icon={<Plus className="size-4" />}
                >
                  Add
                </SubmitButton>
              </div>
            ) : null}
          </div>
        </div>
      </DataState>

      {/* Assign a placed pin to an area */}
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Which area is this pin?</DialogTitle>
            <DialogDescription>
              Every pin represents one area. Pick an existing area or create a
              new one — the pin is never auto-assigned.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Area</Label>
              <Select value={pinAreaChoice} onValueChange={setPinAreaChoice}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_AREA}>+ Create a new area</SelectItem>
                  {unpinnedAreas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pinAreaChoice === NEW_AREA ? (
              <div>
                <Label className="text-xs">New area name</Label>
                <Input
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  placeholder="e.g. Master bedroom"
                  autoFocus
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void confirmPin()}
              disabled={busy}
              pending={running === "pin"}
              pendingLabel="Placing…"
              icon={<MapPin className="size-4" />}
            >
              Place pin
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
              The new name is used everywhere this area appears — its pin, the
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

      {dialog}
    </SectionCard>
  );
}
