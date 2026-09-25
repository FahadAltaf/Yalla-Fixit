"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, ImageOff, Play, Video } from "lucide-react";

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

/*
  A media fragment asking the browser to seek a moment in, so the tile
  shows a real frame of the clip instead of the black it draws before any
  frame has been decoded.
*/
const firstFrame = (url: string) => (url.includes("#") ? url : `${url}#t=0.1`);

/**
 * The tile shown when a file cannot be drawn: a missing object, a link that
 * has expired, or a format the browser cannot decode. It used to be the
 * browser's own broken-image glyph (or nothing at all), which read as a
 * layout bug rather than as "this file is not available".
 */
function UnavailableTile({ video = false }: { video?: boolean }) {
  return (
    <span
      className="bg-muted text-muted-foreground @container absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
      role="img"
      aria-label={video ? "Video unavailable" : "Photo unavailable"}
    >
      <ImageOff className="size-4 shrink-0" aria-hidden />
      <span className="hidden px-1 text-[10px] leading-tight font-medium @[4.5rem]:block">
        Unavailable
      </span>
    </span>
  );
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
  const [failed, setFailed] = useState(false);

  if (!photo.signed_url || failed) {
    return (
      <div
        className={cn(
          "bg-muted text-muted-foreground flex min-h-56 flex-col items-center justify-center gap-2 rounded-md p-6 text-center",
          className,
        )}
      >
        <ImageOff className="size-6" aria-hidden />
        <p className="text-foreground text-sm font-medium">
          This {isVideo(photo) ? "video" : "photo"} can’t be shown
        </p>
        <p className="max-w-sm text-xs">
          The file may still be uploading from the phone, or it is in a format this browser
          can’t display.
        </p>
        {photo.signed_url ? (
          <a
            href={photo.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand mt-1 inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
          >
            <Download className="size-3.5" aria-hidden />
            Download the file
          </a>
        ) : null}
      </div>
    );
  }

  if (isVideo(photo)) {
    return (
      <video
        src={photo.signed_url}
        controls
        playsInline
        // No autoplay: a dialog that starts making noise on open is worse
        // than one that waits to be asked.
        preload="metadata"
        onError={() => setFailed(true)}
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
      onError={() => setFailed(true)}
      className={cn("h-auto w-full rounded-md object-contain", className)}
    />
  );
}

/**
 * The thumbnail form, for grids and rows. Fills a `relative` container.
 *
 * A video is labelled as one -- a dark tile with a play button and "Video"
 * -- with a frame of the clip under it once the browser has one. It used to
 * be the bare video element, which is black until a frame is decoded, so
 * a clip looked like an empty square. A file that will not load says
 * "Unavailable" rather than showing a broken image.
 */
export function EvidenceThumbnail({
  photo,
  className,
}: {
  photo: SnaggingPhoto;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const video = isVideo(photo);

  if (!photo.signed_url || failed) return <UnavailableTile video={video} />;

  if (video) {
    return (
      <>
        {/* The tile itself, visible until (and around) the frame. */}
        <span className="absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900" aria-hidden />
        <video
          src={firstFrame(photo.signed_url)}
          preload="metadata"
          muted
          playsInline
          onError={() => setFailed(true)}
          className={cn("relative size-full object-cover", className)}
        />
        <span className="@container pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="flex size-7 items-center justify-center rounded-full bg-black/60 ring-1 ring-white/30">
            <Play className="ml-0.5 size-3.5 fill-white text-white" aria-hidden />
          </span>
          <span className="hidden items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white @[4.5rem]:inline-flex">
            <Video className="size-3" aria-hidden />
            Video
          </span>
        </span>
        <span className="sr-only">Video</span>
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
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
