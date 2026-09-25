"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MAX_ZONE_POINTS,
  MIN_ZONE_POINTS,
  distance,
  isZone,
  toSvgPoints,
  zoneLabelPoint,
  type ZonePoint,
} from "@/lib/snagging/zone-geometry";

/** One room as the canvas needs to see it, whatever the caller stores. */
export type PlacedArea = {
  /** Stable identity: the area id once saved, the name before that. */
  key: string;
  name: string;
  pinX?: number | null;
  pinY?: number | null;
  zone?: ZonePoint[] | null;
};

/**
 * A snag pinned on the plan (point 7). Drawn over the rooms, coloured by
 * its latest result, and never editable here.
 */
export type PlanMarker = {
  key: string;
  /** 0..1 fractions of the plan. */
  x: number;
  y: number;
  /** Short text inside the dot, e.g. its number in the list. */
  label: string;
  /** Tailwind classes for the dot's fill and text. */
  tone: string;
  /** Shown on hover: the defect, its result and its room. */
  title: string;
  /** Given when the pin opens the thing it marks. */
  onSelect?: () => void;
};

/**
 * A floor plan you can place rooms on, by pin or by zone (BA change 6).
 *
 * Shared by the job wizard and the job's own Areas and Plans tab, because
 * the two were already drifting apart on pins alone and a second placement
 * mode would have doubled that. The caller owns the data and decides what
 * a placement means; this component owns the drawing and the pointer work.
 *
 * Coordinates in and out are 0..1 fractions of the plan image, never
 * pixels, so a zone drawn on a laptop lands correctly on a phone.
 */
export function PlanZoneCanvas({
  src,
  alt,
  areas,
  activeKey,
  mode,
  readOnly,
  onPlacePin,
  onPlaceZone,
  onPickArea,
  markers = [],
}: {
  src: string;
  alt: string;
  areas: PlacedArea[];
  /** The room a new placement belongs to. Null disables placing. */
  activeKey: string | null;
  mode: "pin" | "zone";
  readOnly?: boolean;
  onPlacePin?: (key: string, x: number, y: number) => void;
  onPlaceZone?: (key: string, points: ZonePoint[]) => void;
  /** A click inside an existing zone, when nothing is being placed. */
  onPickArea?: (key: string) => void;
  /** Snag pins drawn over the rooms (point 7). */
  markers?: PlanMarker[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ZonePoint[]>([]);
  /* Which image has finished downloading; a new plan starts unloaded. */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [hover, setHover] = useState<ZonePoint | null>(null);

  const drawing = mode === "zone" && !readOnly && Boolean(activeKey);

  /*
    A half-drawn outline belongs to the room it was started for. Changing
    room or mode mid-draw would otherwise commit it to the wrong one.

    Adjusted during render rather than in an effect. An effect that calls
    setState runs AFTER the browser has been given a frame, so the stale
    outline is painted once against the new room before being cleared —
    and React flags the cascading render for exactly that reason. Comparing
    against the owner while rendering discards it before anything is drawn.
  */
  const owner = `${mode}:${activeKey ?? ""}`;
  const [draftOwner, setDraftOwner] = useState(owner);
  if (draftOwner !== owner) {
    setDraftOwner(owner);
    setDraft([]);
  }

  useEffect(() => {
    if (!drawing) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDraft([]);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        setDraft((current) => current.slice(0, -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        setDraft((current) => {
          if (current.length >= MIN_ZONE_POINTS && activeKey) {
            onPlaceZone?.(activeKey, current);
            return [];
          }
          return current;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing, activeKey, onPlaceZone]);

  function at(event: React.MouseEvent): ZonePoint | null {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    const point = at(event);
    if (!point) return;

    if (readOnly || !activeKey) {
      // Nothing is being placed, so a click is a way of selecting a room.
      if (onPickArea) {
        const hit = areas.find(
          (area) => area.zone && isZone(area.zone) && insideOf(point, area.zone),
        );
        if (hit) onPickArea(hit.key);
      }
      return;
    }

    if (mode === "pin") {
      onPlacePin?.(activeKey, point.x, point.y);
      return;
    }

    /*
      Closing the outline.

      Clicking the first vertex again is the gesture people expect from
      every drawing tool, so it closes the shape rather than adding a
      near-duplicate point on top of it. The threshold is in fractions,
      which is about 12px on a 600px-wide plan.
    */
    if (draft.length >= MIN_ZONE_POINTS && distance(point, draft[0]) < 0.02) {
      onPlaceZone?.(activeKey, draft);
      setDraft([]);
      return;
    }

    if (draft.length >= MAX_ZONE_POINTS) return;
    setDraft((current) => [...current, point]);
  }

  function onDoubleClick() {
    if (!drawing || draft.length < MIN_ZONE_POINTS || !activeKey) return;
    onPlaceZone?.(activeKey, draft);
    setDraft([]);
  }

  const placed = areas.filter((area) => area.zone && isZone(area.zone));
  const pinned = areas.filter(
    (area) => !area.zone && area.pinX != null && area.pinY != null,
  );

  return (
    <div
      ref={wrapRef}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseMove={(event) => drawing && setHover(at(event))}
      onMouseLeave={() => setHover(null)}
      className={cn(
        "border-border bg-mist-soft relative overflow-hidden rounded-lg border select-none",
        !readOnly && activeKey && "cursor-crosshair",
      )}
    >
      {/*
        The plan is a full-size image from storage and takes a moment on a
        slow line; until it is in, a placeholder holds the space and says
        so, instead of an empty strip with the pins floating over nothing.
      */}
      {loadedSrc !== src ? (
        <div className="flex h-72 items-center justify-center" role="status">
          <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
            <Loader2 className="size-4 animate-spin" />
            Loading the plan…
          </span>
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={cn("block w-full", loadedSrc !== src && "absolute inset-x-0 top-0 opacity-0")}
        draggable={false}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setLoadedSrc(src)}
      />

      {/*
        One SVG over the whole plan in a 0..100 viewBox, so every outline
        is written in the same fractions it is stored in and scales with
        the image instead of being repositioned on resize.
      */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {placed.map((area) => {
          const active = area.key === activeKey;
          return (
            <polygon
              key={area.key}
              points={toSvgPoints(area.zone as ZonePoint[])}
              className={cn(
                "stroke-brand",
                active ? "fill-brand/25" : "fill-brand/10",
              )}
              vectorEffect="non-scaling-stroke"
              strokeWidth={active ? 2 : 1.25}
            />
          );
        })}

        {draft.length > 0 ? (
          <>
            <polyline
              points={toSvgPoints(hover ? [...draft, hover] : draft)}
              className="stroke-brand fill-none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            {draft.map((point, index) => (
              <circle
                key={`${point.x}-${point.y}-${index}`}
                cx={point.x * 100}
                cy={point.y * 100}
                r={index === 0 ? 1.6 : 1.1}
                className={cn(
                  "stroke-brand",
                  index === 0 ? "fill-background" : "fill-brand",
                )}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1.25}
              />
            ))}
          </>
        ) : null}
      </svg>

      {/* Labels sit outside the SVG: the 0..100 viewBox is stretched to the
          plan's aspect ratio, which would stretch any text drawn inside it. */}
      {placed.map((area) => {
        const centre = zoneLabelPoint(area.zone as ZonePoint[]);
        return (
          <span
            key={area.key}
            style={{ left: `${centre.x * 100}%`, top: `${centre.y * 100}%` }}
            className="bg-brand text-primary-foreground pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium whitespace-nowrap shadow-sm"
          >
            {area.name}
          </span>
        );
      })}

      {pinned.map((area) => (
        <span
          key={area.key}
          style={{
            left: `${(area.pinX ?? 0) * 100}%`,
            top: `${(area.pinY ?? 0) * 100}%`,
          }}
          className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
        >
          <span className="bg-brand text-primary-foreground rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium whitespace-nowrap shadow-sm">
            {area.name}
          </span>
          <MapPin className="text-brand size-4 drop-shadow-sm" />
        </span>
      ))}

      {/*
        Snag pins, over the rooms. Each says what it is on hover, and
        opens it where the caller gave it somewhere to go -- a pin on a
        plan is the most natural way to reach a defect, and it used to be
        decoration.

        The click is kept off the plan underneath, which would otherwise
        read it as placing a pin.
      */}
      {markers.map((marker) => {
        const style = {
          left: `${marker.x * 100}%`,
          top: `${marker.y * 100}%`,
        } as const;
        const className = cn(
          "absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[0.625rem] font-semibold shadow-md",
          marker.tone,
        );
        return marker.onSelect ? (
          <button
            key={marker.key}
            type="button"
            title={marker.title}
            aria-label={marker.title}
            style={style}
            className={cn(className, "cursor-pointer hover:brightness-110")}
            onClick={(event) => {
              event.stopPropagation();
              marker.onSelect?.();
            }}
          >
            {marker.label}
          </button>
        ) : (
          <span key={marker.key} title={marker.title} style={style} className={className}>
            {marker.label}
          </span>
        );
      })}

      {drawing ? (
        <p className="bg-background/90 text-muted-foreground pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-sm">
          {draft.length < MIN_ZONE_POINTS
            ? `Click the corners of the room. ${MIN_ZONE_POINTS - draft.length} more to close it.`
            : "Click the first corner, double-click, or press Enter to close. Backspace undoes."}
        </p>
      ) : null}
    </div>
  );
}

/** Local copy of the hit test, so the module keeps one import surface. */
function insideOf(point: ZonePoint, polygon: ZonePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}
