"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingFloorPlan } from "@/types/types";

import { SectionCard } from "./shared";

/** Reads an image's natural pixel size so pins resolve to the right place. */
function readImageSize(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve({});
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
  });
}

/**
 * Floor plans for a job (G3): a coordinator adds one plan per floor,
 * labels them, and removes any that were uploaded by mistake. The
 * inspector then pins each snag to the right floor on the device.
 */
export function FloorPlansPanel({ taskId }: { taskId: string }) {
  const { user } = useAuth();
  const canEdit = hasResourceAction(user, ResourceType.SNAGGING, ActionType.EDIT);
  const fileRef = useRef<HTMLInputElement>(null);

  const [plans, setPlans] = useState<SnaggingFloorPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await snaggingService.listFloorPlans(taskId));
    } catch {
      // A load failure should not break the job view.
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const size = await readImageSize(file);
      await snaggingService.uploadFloorPlan(taskId, file, {
        label: label.trim() || `Floor ${plans.length + 1}`,
        width: size.width,
        height: size.height,
      });
      setLabel("");
      toast.success("Floor plan added");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the plan");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(plan: SnaggingFloorPlan) {
    setBusy(true);
    try {
      await snaggingService.deleteFloorPlan(plan.id);
      toast.success("Floor plan removed");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the plan");
    } finally {
      setBusy(false);
    }
  }

  if (!loading && plans.length === 0 && !canEdit) return null;

  return (
    <SectionCard
      title="Floor plans"
      description={plans.length === 1 ? "1 plan" : `${plans.length} plans`}
      bodyClassName="border-t p-5"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.id} className="overflow-hidden rounded-lg border">
            <div className="bg-muted relative aspect-video">
              {plan.signed_url ? (
                <Image
                  src={plan.signed_url}
                  alt={plan.label}
                  fill
                  unoptimized
                  sizes="240px"
                  className="object-cover"
                />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-sm font-medium">{plan.label}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void remove(plan)}
                  disabled={busy}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Remove ${plan.label}`}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Ground floor)"
            className="max-w-56"
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
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Add plan
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
