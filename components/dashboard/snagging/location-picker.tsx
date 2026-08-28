"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Crosshair, Loader2, MapPin, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Click-to-place location picker on OpenStreetMap tiles.
 *
 * Leaflet is loaded on demand rather than imported at the top: it
 * touches `window` on import, so pulling it into the module graph would
 * break the server render of any page the wizard sits on. It is also a
 * few hundred kilobytes that only matters on one step of one form.
 *
 * Search goes through Nominatim, which is free and needs no key, but is
 * rate-limited and asks callers not to hammer it — so it only runs when
 * the coordinator submits the box, never per keystroke.
 */

/** Dubai, so an empty picker opens somewhere useful rather than mid-ocean. */
const FALLBACK: [number, number] = [25.0772, 55.1345];

type SearchHit = { label: string; lat: number; lng: number };

export function LocationPicker({
  lat,
  lng,
  onPick,
  onClear,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const hasPin = lat !== null && lng !== null;

  // Build the map once, on the client.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;

      map = L.map(containerRef.current, { attributionControl: true }).setView(
        hasPin ? [lat, lng] : FALLBACK,
        hasPin ? 17 : 11,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      // Leaflet's default marker images do not survive bundling, so the
      // pin is drawn as markup instead — which also lets it match the
      // brand rather than shipping a stock blue teardrop.
      const icon = L.divIcon({
        className: "",
        html:
          '<span style="display:block;width:18px;height:18px;border-radius:9999px;' +
          'background:#9F2B23;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        onPickRef.current(
          Number(event.latlng.lat.toFixed(6)),
          Number(event.latlng.lng.toFixed(6)),
        );
      });

      if (hasPin) {
        markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current?.getLatLng();
          if (p) onPickRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
        });
      }

      mapRef.current = map;
      // Tiles come up grey if the container was measured while hidden.
      setTimeout(() => map?.invalidateSize(), 0);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Built once; the pin is kept in step by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker following the value, wherever it was changed —
  // the map, the search results, or the two number fields beside it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    void (async () => {
      const L = await import("leaflet");
      if (!hasPin) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      const icon = L.divIcon({
        className: "",
        html:
          '<span style="display:block;width:18px;height:18px;border-radius:9999px;' +
          'background:#9F2B23;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current?.getLatLng();
          if (p) onPickRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
        });
      }
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    })();
  }, [lat, lng, hasPin, ready]);

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    setSearchError(null);
    setHits([]);
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" +
        encodeURIComponent(term);
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const rows = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
      }>;
      if (rows.length === 0) {
        setSearchError("No match. Try the building or community name.");
        return;
      }
      setHits(
        rows.map((row) => ({
          label: row.display_name,
          lat: Number(row.lat),
          lng: Number(row.lon),
        })),
      );
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Could not search right now.",
      );
    } finally {
      setSearching(false);
    }
  }, [query]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setSearchError("This browser cannot report a location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        onPick(Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))),
      () => setSearchError("Location permission was refused."),
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runSearch();
              }
            }}
            placeholder="Search a building, community or address"
            className="pl-9"
            aria-label="Search for the property location"
          />
        </div>
        <Button type="button" variant="outline" onClick={() => void runSearch()} disabled={searching}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </Button>
        <Button type="button" variant="outline" onClick={useMyLocation}>
          <Crosshair className="size-4" />
          Use my location
        </Button>
      </div>

      {hits.length > 0 ? (
        <ul className="max-h-40 overflow-y-auto rounded-md border">
          {hits.map((hit) => (
            <li key={`${hit.lat},${hit.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit.lat, hit.lng);
                  setHits([]);
                }}
                className="hover:bg-muted flex w-full items-start gap-2 px-3 py-2 text-left text-sm"
              >
                <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{hit.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {searchError ? <p className="text-destructive text-xs">{searchError}</p> : null}

      {/*
        The element Leaflet owns must keep a CONSTANT className. Leaflet
        adds its own classes to it on init (leaflet-container and
        friends), and React rewrites className on every re-render — so a
        conditional class here silently stripped them. Losing
        leaflet-container in particular takes out Leaflet's own
        `.leaflet-container img { max-width: none }` guard, and Tailwind
        preflight's `img { max-width: 100% }` then resolves against a
        0x0 pane and collapses every tile to zero width: a map that
        loads its tiles perfectly and renders nothing.
        The loading state therefore lives on the wrapper.
      */}
      <div
        className={cn(
          "bg-muted h-72 w-full overflow-hidden rounded-lg border",
          !ready && "animate-pulse",
        )}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          {hasPin
            ? `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)} — click the map or drag the pin to move it.`
            : "Click the map to drop a pin, or search for the address above."}
        </span>
        {hasPin ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="size-3.5" />
            Clear pin
          </Button>
        ) : null}
      </div>
    </div>
  );
}
