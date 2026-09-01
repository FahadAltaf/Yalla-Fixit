"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isPlottable } from "./location-map";

/**
 * The property's location on Google Maps, for the job detail Setup tab.
 *
 * Uses the Maps *Embed* API rather than the Maps JavaScript API: this view
 * is read-only -- one pin, no click-to-move, no custom overlays -- and the
 * Embed API's basic place mode is free and unmetered, where the JS API bills
 * per map load and would need an npm dependency and a script loader. If the
 * Setup tab ever needs custom markers or drawing, the JS API is the upgrade
 * path.
 *
 * The key is read from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Callers must handle
 * the no-key case (see hasGoogleMapsKey) -- this component assumes a key.
 */
export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export function hasGoogleMapsKey() {
  return GOOGLE_MAPS_API_KEY.length > 0;
}

export function GoogleLocationMap({
  lat,
  lng,
  label,
  className,
}: {
  lat: number;
  lng: number;
  /** Names the place for screen readers and the iframe title. */
  label?: string | null;
  className?: string;
}) {
  const [ready, setReady] = useState(false);

  // Same guard as the Leaflet map: an impossible pair would otherwise be
  // rendered as a confident pin somewhere near the pole.
  if (!isPlottable(lat, lng)) {
    return (
      <div className={cn("flex min-h-56 flex-col justify-center gap-2", className)}>
        <p className="text-muted-foreground text-sm">
          These coordinates are outside the range a real place can have (
          {String(lat)}, {String(lng)}). Re-pin the property to fix it.
        </p>
      </div>
    );
  }

  const query = `${lat},${lng}`;
  const src =
    `https://www.google.com/maps/embed/v1/place` +
    `?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
    `&q=${encodeURIComponent(query)}` +
    `&zoom=17`;

  return (
    <div className={cn("flex min-h-56 flex-col gap-2", className)}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
        <iframe
          // Keying on the coordinates remounts the frame when the pin moves;
          // the Embed API does not react to a changed src otherwise.
          key={query}
          src={src}
          title={label ? `Map showing ${label}` : `Map showing ${query}`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          onLoad={() => setReady(true)}
          className="size-full min-h-56 border-0"
        />
        {!ready ? (
          // A skeleton the shape of the map, matching the Leaflet version --
          // the frame fills this whole box, so the placeholder should too.
          <div className="absolute inset-0">
            <Skeleton className="size-full rounded-none" />
            <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
              Loading map…
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <Button asChild size="sm" variant="outline">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${query}`}
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
