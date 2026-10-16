"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Crosshair, Loader2, MapPin, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GOOGLE_MAPS_BROWSER_KEY,
  loadGoogleMaps,
  type GoogleMap,
  type GoogleMapsApi,
  type GoogleMarker,
} from "@/lib/google-maps-loader";
import { cn } from "@/lib/utils";

/**
 * Click-to-place location picker.
 *
 * On Google Maps whenever the portal has a Google Maps key (the team asked
 * for Google's map everywhere a map is shown), with search through Google's
 * geocoder. Without a key it falls back to Leaflet on OpenStreetMap tiles
 * and Nominatim search, so a local checkout with no key still works.
 *
 * Both map libraries load on demand rather than at the top: Leaflet touches
 * `window` on import, and either one would otherwise weigh down every page
 * the wizard sits on for one step of one form. Search only runs when the
 * coordinator submits the box, never per keystroke.
 */

/** Dubai, so an empty picker opens somewhere useful rather than mid-ocean. */
const FALLBACK: [number, number] = [25.0772, 55.1345];

const BRAND = "#9F2B23";

type SearchHit = { label: string; lat: number; lng: number };

const round6 = (value: number) => Number(value.toFixed(6));

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
  const useGoogle = GOOGLE_MAPS_BROWSER_KEY.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const googleRef = useRef<GoogleMapsApi | null>(null);
  const gMapRef = useRef<GoogleMap | null>(null);
  const gMarkerRef = useRef<GoogleMarker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const hasPin = lat !== null && lng !== null;

  // Build the map once, on the client.
  useEffect(() => {
    let cancelled = false;

    if (useGoogle) {
      void loadGoogleMaps()
        .then((maps) => {
          if (cancelled || !containerRef.current || gMapRef.current) return;
          googleRef.current = maps;
          const map = new maps.Map(containerRef.current, {
            center: hasPin ? { lat, lng } : { lat: FALLBACK[0], lng: FALLBACK[1] },
            zoom: hasPin ? 17 : 11,
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
            clickableIcons: false,
            // A map inside a scrolling form should not swallow the page
            // scroll; Ctrl + scroll (or two fingers) zooms it.
            gestureHandling: "cooperative",
          });
          map.addListener("click", (event) => {
            const at = event.latLng;
            if (at) onPickRef.current(round6(at.lat()), round6(at.lng()));
          });
          gMapRef.current = map;
          setReady(true);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setMapError(error instanceof Error ? error.message : "The map could not load.");
          }
        });
      return () => {
        cancelled = true;
        gMarkerRef.current?.setMap(null);
        gMarkerRef.current = null;
        gMapRef.current = null;
      };
    }

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

      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        onPickRef.current(round6(event.latlng.lat), round6(event.latlng.lng));
      });

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
    if (!ready) return;

    if (useGoogle) {
      const maps = googleRef.current;
      const map = gMapRef.current;
      if (!maps || !map) return;
      if (!hasPin) {
        gMarkerRef.current?.setMap(null);
        gMarkerRef.current = null;
        return;
      }
      const position = { lat, lng };
      if (gMarkerRef.current) {
        gMarkerRef.current.setPosition(position);
      } else {
        const marker = new maps.Marker({
          position,
          map,
          draggable: true,
          title: "Property location",
          // The brand dot rather than the stock red teardrop.
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: BRAND,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          if (p) onPickRef.current(round6(p.lat()), round6(p.lng()));
        });
        gMarkerRef.current = marker;
      }
      map.panTo(position);
      map.setZoom(Math.max(map.getZoom() ?? 0, 16));
      return;
    }

    const map = mapRef.current;
    if (!map) return;
    void (async () => {
      const L = await import("leaflet");
      if (!hasPin) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      // Leaflet's default marker images do not survive bundling, so the
      // pin is drawn as markup instead, in the brand colour.
      const icon = L.divIcon({
        className: "",
        html:
          `<span style="display:block;width:18px;height:18px;border-radius:9999px;` +
          `background:${BRAND};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current?.getLatLng();
          if (p) onPickRef.current(round6(p.lat), round6(p.lng));
        });
      }
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    })();
  }, [lat, lng, hasPin, ready, useGoogle]);

  /** Nominatim: free and keyless, used when Google is not available. */
  const searchNominatim = useCallback(async (term: string): Promise<SearchHit[]> => {
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
    return rows.map((row) => ({
      label: row.display_name,
      lat: Number(row.lat),
      lng: Number(row.lon),
    }));
  }, []);

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    setSearchError(null);
    setHits([]);
    try {
      let found: SearchHit[] = [];
      const maps = googleRef.current;
      if (maps) {
        try {
          // Biased to the UAE, where every property is.
          const { results } = await new maps.Geocoder().geocode({
            address: term,
            region: "ae",
          });
          found = results.slice(0, 5).map((result) => ({
            label: result.formatted_address,
            lat: round6(result.geometry.location.lat()),
            lng: round6(result.geometry.location.lng()),
          }));
        } catch {
          // Geocoding not enabled on the key, or no match: try Nominatim.
          found = await searchNominatim(term);
        }
      } else {
        found = await searchNominatim(term);
      }
      if (found.length === 0) {
        setSearchError("No match. Try the building or community name.");
        return;
      }
      setHits(found);
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Could not search right now.",
      );
    } finally {
      setSearching(false);
    }
  }, [query, searchNominatim]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setSearchError("This browser cannot report a location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onPick(round6(pos.coords.latitude), round6(pos.coords.longitude)),
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
        The element the map library owns must keep a CONSTANT className.
        Leaflet adds its own classes to it on init (leaflet-container and
        friends), and React rewrites className on every re-render -- so a
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
          "bg-muted relative isolate h-72 w-full overflow-hidden rounded-lg border",
          !ready && !mapError && "animate-pulse",
        )}
      >
        <div ref={containerRef} className="h-full w-full" />
        {mapError ? (
          <p className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm">
            {mapError} Search for the address or use your location to set the pin.
          </p>
        ) : null}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          {hasPin
            ? `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Click the map or drag the pin to move it.`
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
