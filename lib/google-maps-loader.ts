/**
 * Loads the Google Maps JavaScript API once, in the browser.
 *
 * A plain script tag rather than an npm loader: one map component needs it,
 * and the API is a global either way. The key is the public browser key in
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, which should be restricted to the
 * portal's domains in the Google Cloud console.
 *
 * Only the few members the portal uses are typed here, so no @types package
 * is needed.
 */

export type LatLngLiteral = { lat: number; lng: number };

export type GoogleLatLng = { lat(): number; lng(): number };

export type GoogleMapsListener = { remove(): void };

export type GoogleMap = {
  setCenter(position: LatLngLiteral): void;
  panTo(position: LatLngLiteral): void;
  setZoom(zoom: number): void;
  getZoom(): number | undefined;
  addListener(event: string, handler: (event: { latLng?: GoogleLatLng | null }) => void): GoogleMapsListener;
};

export type GoogleMarker = {
  setPosition(position: LatLngLiteral): void;
  getPosition(): GoogleLatLng | null | undefined;
  setMap(map: GoogleMap | null): void;
  addListener(event: string, handler: () => void): GoogleMapsListener;
};

export type GeocoderResult = {
  formatted_address: string;
  geometry: { location: GoogleLatLng };
};

export type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
  Geocoder: new () => {
    geocode(request: Record<string, unknown>): Promise<{ results: GeocoderResult[] }>;
  };
  SymbolPath: { CIRCLE: number };
};

export const GOOGLE_MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

let loading: Promise<GoogleMapsApi> | null = null;

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps only loads in the browser"));
  }
  const existing = (window as unknown as { google?: { maps?: GoogleMapsApi } }).google?.maps;
  if (existing?.Map) return Promise.resolve(existing);
  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return Promise.reject(new Error("No Google Maps key is configured"));
  }
  if (loading) return loading;

  loading = new Promise<GoogleMapsApi>((resolve, reject) => {
    const callback = "__yfiGoogleMapsReady";
    (window as unknown as Record<string, unknown>)[callback] = () => {
      const maps = (window as unknown as { google?: { maps?: GoogleMapsApi } }).google?.maps;
      if (maps?.Map) resolve(maps);
      else reject(new Error("Google Maps did not load"));
    };
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}` +
      `&v=weekly&callback=${callback}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // A failed load can be retried on the next mount.
      loading = null;
      reject(new Error("Google Maps could not be reached"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
