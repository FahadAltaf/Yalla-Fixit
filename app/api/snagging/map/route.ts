import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * A still map of one point, for the inspector app.
 *
 * The app used to draw its own map from raw OpenStreetMap tiles. OSM's
 * tile policy does not allow an application to do that, and they block
 * it -- the app was rendering a grid of "blocked" placeholders with a
 * 403 where the property should be.
 *
 * So the picture is fetched here instead, with the Google key the portal
 * already holds. Going through the portal rather than calling Google
 * from the phone keeps the key off every installed device (an
 * EXPO_PUBLIC_ value is readable by anyone who unzips the app) and means
 * one key to restrict and rotate.
 *
 * Signed in, like the rest of this API: a public image proxy on a billed
 * Google key is somebody else's free map service.
 */

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** Rejects a pair no real place has, rather than pinning it near a pole. */
function plottable(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Clamps to what the Static Maps API accepts, so a bad width is not a 400. */
function size(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), 64), max);
}

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!KEY) {
      return NextResponse.json({ error: "Maps key is not configured" }, { status: 503 });
    }

    const params = req.nextUrl.searchParams;
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (!plottable(lat, lng)) {
      return NextResponse.json({ error: "Coordinates out of range" }, { status: 400 });
    }

    const width = size(params.get("w"), 640, 640);
    const height = size(params.get("h"), 280, 640);
    const zoom = Math.min(Math.max(Number(params.get("zoom")) || 16, 1), 20);
    /* Retina, so the pin and the labels are not soft on a phone. */
    const scale = params.get("scale") === "1" ? 1 : 2;

    const point = `${lat},${lng}`;
    const url =
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?center=${encodeURIComponent(point)}` +
      `&zoom=${zoom}&size=${width}x${height}&scale=${scale}` +
      `&markers=${encodeURIComponent(`color:0xB23A3A|${point}`)}` +
      `&key=${encodeURIComponent(KEY)}`;

    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) {
      /*
        Google answers a rejected key with a readable line rather than an
        image, and it is the only thing that says why, so it is worth
        carrying into the log instead of a bare status.
      */
      const detail = await upstream.text().catch(() => "");
      console.error("[snagging/map] static map failed", upstream.status, detail.slice(0, 200));
      return NextResponse.json(
        { error: "Map could not be loaded" },
        { status: upstream.status === 403 ? 502 : 502 },
      );
    }

    return new NextResponse(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        /*
          A property does not move, so the phone and the CDN may keep the
          picture for a day. That is also what lets it survive a walk
          through a basement: the image layer serves it from disk.
        */
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    console.error("[snagging/map]", error);
    return NextResponse.json({ error: "Map could not be loaded" }, { status: 500 });
  }
}
