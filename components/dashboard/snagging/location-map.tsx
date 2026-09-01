"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Whether a coordinate pair can exist.
 *
 * Leaflet clamps a latitude outside ±90 to the edge of the projection
 * and draws a pin there without complaint, so a property recorded at
 * latitude 93 renders a confident marker near the north pole. A map that
 * is wrong is worse than no map, so an impossible pair is refused.
 */
export function isPlottable(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * The property's location, shown rather than linked.
 *
 * The read-only twin of LocationPicker: same Leaflet + OpenStreetMap
 * tiles, same brand pin, no click-to-move and no search. A coordinator
 * opening a job wants to see where the unit is without leaving the page
 * for a new tab and coming back.
 *
 * Leaflet is imported on demand for the same reason as in the picker —
 * it touches `window` at import time, so pulling it into the module
 * graph would break the server render of the page this sits on.
 */
export function LocationMap({
  lat,
  lng,
  label,
  className,
}: {
  lat: number;
  lng: number;
  /** Names the place for screen readers and the marker tooltip. */
  label?: string | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    void (async () => {
      try {
        const L = await import("leaflet");
        if (cancelled || !containerRef.current || mapRef.current) return;

        map = L.map(containerRef.current, {
          attributionControl: true,
          // A map inside a scrolling form should not swallow the page
          // scroll when the pointer crosses it. Zoom stays available on
          // the buttons and on a deliberate double-click.
          scrollWheelZoom: false,
        }).setView([lat, lng], 17);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        // Leaflet's default marker images do not survive bundling, so the
        // pin is markup — and matches the brand rather than shipping a
        // stock blue teardrop.
        const icon = L.divIcon({
          className: "",
          html:
            '<span style="display:block;width:18px;height:18px;border-radius:9999px;' +
            'background:#9F2B23;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map);
        if (label) marker.bindTooltip(label);

        mapRef.current = map;
        // Tiles come up grey if the container was measured while hidden,
        // which it is on a tab that was not the one first opened.
        setTimeout(() => map?.invalidateSize(), 0);
        setReady(true);
      } catch {
        // A map that will not load is worth saying so about; the
        // coordinates still open in a map service below.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, label]);

  if (!isPlottable(lat, lng)) {
    return (
      <div
        className={cn(
          "bg-muted/40 text-muted-foreground rounded-lg border border-dashed p-4 text-sm",
          className,
        )}
      >
        <p className="text-foreground font-medium">Location cannot be shown</p>
        <p className="mt-1">
          The coordinates on the property record are outside the possible range
          (
          <span className="font-mono">
            {lat}, {lng}
          </span>
          ), so they cannot be a real place. Re-pin the property to fix it.
        </p>
      </div>
    );
  }

  return (
    // A column, so the map box can be told to grow into whatever height
    // the caller's layout gives it while the coordinate row stays put
    // underneath at its natural size.
    <div className={cn("flex min-h-56 flex-col gap-2", className)}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
        {/*
          The className here must stay constant. Leaflet writes its own
          classes onto this element, and re-rendering it with a different
          string strips them — which silently collapses every tile to
          zero width under the CSS reset.
        */}
        <div
          ref={containerRef}
          className="size-full min-h-56"
          role="img"
          aria-label={
            label ? `Map showing ${label}` : `Map showing ${lat}, ${lng}`
          }
        />
        {!ready && !failed ? (
          // A skeleton the shape of the map, rather than a spinner on a
          // grey wash: the tiles fill this whole box, so the placeholder
          // should too.
          <div className="absolute inset-0">
            <Skeleton className="size-full rounded-none" />
            <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
              Loading map…
            </span>
          </div>
        ) : null}
        {failed ? (
          <div className="bg-muted/60 text-muted-foreground absolute inset-0 flex items-center justify-center px-4 text-center text-sm">
            The map could not be loaded. The coordinates are still below.
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <Button asChild size="sm" variant="outline">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-3.5" />
            Directions
          </a>
        </Button>
      </div>
    </div>
  );
}
