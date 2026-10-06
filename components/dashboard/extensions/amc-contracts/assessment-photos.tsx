"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ListSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { AMC_PHOTOS_PER_ASSESSMENT, AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { amcContractsService, type AssessmentPhoto } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Photos of the property, kept privately with the assessment. Added and
 * removed while it is a draft; once completed they are kept as they are.
 * Links to the files expire after ten minutes and are refreshed on load.
 */
export function AssessmentPhotos({ assessmentId, editable, completed }: { assessmentId: string; editable: boolean; completed: boolean }) {
  const [photos, setPhotos] = useState<AssessmentPhoto[] | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const data = await amcContractsService.assessmentPhotos(assessmentId);
      setPhotos(data.photos);
      setMigrated(data.migrated);
    } catch (e) {
      setPhotos([]);
      toast.error(e instanceof Error ? e.message : "Could not load the photos.");
    }
  }, [assessmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > AMC_PHOTO_MAX_BYTES) {
          toast.error(`${file.name} is larger than 10 MB.`);
          continue;
        }
        await amcContractsService.addAssessmentPhoto(assessmentId, file);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (photo: AssessmentPhoto) => {
    const ok = await confirm({ title: "Remove this photo?", description: "It is removed from the draft assessment.", confirmText: "Remove", variant: "destructive" });
    if (!ok) return;
    setBusy(true);
    try {
      await amcContractsService.removeAssessmentPhoto(assessmentId, photo.id);
      setPhotos((list) => (list ?? []).filter((p) => p.id !== photo.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setBusy(false);
    }
  };

  if (!migrated) return null;
  const count = photos?.length ?? 0;

  return (
    <SectionCard
      title="Photos"
      description={
        completed
          ? "Kept with the completed assessment as evidence. They cannot be changed."
          : `Up to ${AMC_PHOTOS_PER_ASSESSMENT} JPEG, PNG or WebP photos, 10 MB each. Stored privately.`
      }
      icon={<Camera />}
      bodyClassName="px-5 pb-5 grid gap-3"
      action={
        editable && !completed ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void add(e.target.files)}
            />
            <Button size="sm" variant="outline" disabled={busy || count >= AMC_PHOTOS_PER_ASSESSMENT} onClick={() => input.current?.click()}>
              <ImagePlus className="size-4" />
              {busy ? "Uploading…" : "Add photos"}
            </Button>
          </>
        ) : undefined
      }
    >
      {dialog}
      {photos === null ? (
        <ListSkeleton rows={1} />
      ) : photos.length === 0 ? (
        <p className="text-muted-foreground text-sm">No photos{completed ? " were added" : " yet"}.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="group relative overflow-hidden rounded-lg border">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img src={p.url} alt={p.caption ?? "Assessment photo"} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center text-xs">Unavailable</div>
              )}
              {editable && !completed ? (
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-1.5 right-1.5 size-7 opacity-90"
                  aria-label="Remove photo"
                  disabled={busy}
                  onClick={() => void remove(p)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
