"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { AMC_PHOTOS_PER_ASSESSMENT, AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { amcContractsService, type AssessmentPhoto } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Photos of the property, kept privately with the site visit. Added and
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

  /* The confirmation runs the removal itself, so it stays open until it is done. */
  const remove = (photo: AssessmentPhoto) =>
    void confirm({
      title: "Remove this photo?",
      description: "It is removed from the draft site visit.",
      confirmText: "Remove",
      variant: "destructive",
      action: async () => {
        await amcContractsService.removeAssessmentPhoto(assessmentId, photo.id);
        setPhotos((list) => (list ?? []).filter((p) => p.id !== photo.id));
        toast.success("Photo removed");
      },
    });

  if (!migrated) {
    return (
      <SectionCard title="Photos" icon={<Camera />} bodyClassName="px-5 pb-5">
        <p className="text-muted-foreground text-sm">Photos are not available on this database yet.</p>
      </SectionCard>
    );
  }
  const count = photos?.length ?? 0;
  const canAdd = editable && !completed;

  return (
    <SectionCard
      title="Photos"
      description={
        completed ? "Kept with the completed site visit as evidence. They cannot be changed." : `Up to ${AMC_PHOTOS_PER_ASSESSMENT} JPEG, PNG or WebP photos, 10 MB each. Stored privately.`
      }
      icon={<Camera />}
      bodyClassName={photos && photos.length === 0 ? "border-t" : "px-5 pb-5"}
      action={
        canAdd ? (
          <>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
            <SubmitButton
              size="sm"
              variant="outline"
              disabled={count >= AMC_PHOTOS_PER_ASSESSMENT}
              pending={busy}
              pendingLabel="Uploading…"
              icon={<ImagePlus className="size-4" />}
              onClick={() => input.current?.click()}
            >
              Add photos
            </SubmitButton>
          </>
        ) : undefined
      }
    >
      {dialog}
      {photos === null ? (
        <ListSkeleton rows={1} />
      ) : photos.length === 0 ? (
        <EmptyState
          icon={<Camera className="size-5" />}
          title={completed ? "No photos were added" : "No photos yet"}
          description={canAdd ? "Add photos of the property and anything that needs attention." : "Photos added to the site visit appear here."}
          action={canAdd ? { label: "Add photos", onClick: () => input.current?.click(), variant: "outline" } : undefined}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="group relative overflow-hidden rounded-lg border">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img src={p.url} alt={p.caption ?? "Site visit photo"} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center text-xs">Unavailable</div>
              )}
              {canAdd ? (
                <Button size="icon" variant="secondary" className="absolute top-1.5 right-1.5 size-7 opacity-90" aria-label="Remove photo" disabled={busy} onClick={() => remove(p)}>
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
