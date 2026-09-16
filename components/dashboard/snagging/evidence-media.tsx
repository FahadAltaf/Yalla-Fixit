"use client";

import Image from "next/image";
import { Play } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SnaggingPhoto } from "@/types/types";

/**
 * Whether a piece of evidence is a clip rather than a still.
 *
 * `media_type` is what the device recorded and the uploader confirmed
 * from the file's own content type, so it is the answer. The extension is
 * a fallback for rows written before that column carried a value — every
 * one of those was rendered through next/image, which cannot decode a
 * video and drew a broken still with no way to play it.
 */
export function isVideo(photo: Pick<SnaggingPhoto, "media_type" | "storage_path">): boolean {
  if (photo.media_type === "video") return true;
  const path = photo.storage_path ?? "";
  return /\.(mp4|mov|m4v|webm|qt)$/i.test(path);
}

/**
 * One piece of evidence at full size: a player for a clip, an image for a
 * still.
 *
 * `controls` rather than an autoplaying loop — a reviewer opening a snag
 * wants to scrub to the moment the defect is visible, and sound may
 * matter (a rattling extractor, a hissing valve).
 */
export function EvidenceViewer({
  photo,
  className,
}: {
  photo: SnaggingPhoto;
  className?: string;
}) {
  if (!photo.signed_url) return null;

  if (isVideo(photo)) {
    return (
      <video
        src={photo.signed_url}
        controls
        playsInline
        // No autoplay: a dialog that starts making noise on open is worse
        // than one that waits to be asked.
        preload="metadata"
        className={cn("h-auto max-h-[70vh] w-full rounded-md bg-black", className)}
      >
        {/* Reached only where the browser cannot play the container at
            all; the link still gets the reviewer to the file. */}
        <a href={photo.signed_url} target="_blank" rel="noopener noreferrer">
          Download the video
        </a>
      </video>
    );
  }

  return (
    <Image
      src={photo.signed_url}
      alt="Snag evidence"
      width={1280}
      height={960}
      unoptimized
      className={cn("h-auto w-full rounded-md object-contain", className)}
    />
  );
}

/**
 * The thumbnail form, for grids and rows.
 *
 * A video has no still to show until the browser has fetched enough of it
 * to decode a frame, so the element is the video itself with
 * `preload="metadata"` and a play badge over it. That keeps the tile
 * honest — it looks like a clip because it is one — without downloading
 * the whole file to draw a 48px square.
 */
export function EvidenceThumbnail({
  photo,
  className,
}: {
  photo: SnaggingPhoto;
  className?: string;
}) {
  if (!photo.signed_url) return null;

  if (isVideo(photo)) {
    return (
      <>
        <video
          src={photo.signed_url}
          preload="metadata"
          muted
          playsInline
          className={cn("size-full object-cover", className)}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-6 items-center justify-center rounded-full bg-black/60">
            <Play className="size-3 fill-white text-white" aria-hidden />
          </span>
        </span>
      </>
    );
  }

  return (
    <Image
      src={photo.signed_url}
      alt=""
      fill
      unoptimized
      sizes="120px"
      className={cn("object-cover", className)}
    />
  );
}
