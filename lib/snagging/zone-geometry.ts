/**
 * Zone geometry (BA change 6, FR-3.05).
 *
 * A zone is the outline of a room on a floor plan, held as fractions of the
 * plan image so it survives any render size — the same convention the pins
 * already use. Everything here is pure, because the inspector app has to
 * reproduce `pointInZone` exactly for its tap-to-open behaviour and the
 * portal has to agree with it about what "inside" means.
 */

export type ZonePoint = { x: number; y: number };

/** The fewest points that enclose anything. */
export const MIN_ZONE_POINTS = 3;

/** Cap on vertices, so one fiddly outline cannot bloat every sync payload. */
export const MAX_ZONE_POINTS = 64;

/** True when the value is a usable outline rather than a stray fragment. */
export function isZone(value: unknown): value is ZonePoint[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_ZONE_POINTS &&
    value.length <= MAX_ZONE_POINTS &&
    value.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as ZonePoint).x === "number" &&
        typeof (p as ZonePoint).y === "number" &&
        (p as ZonePoint).x >= 0 &&
        (p as ZonePoint).x <= 1 &&
        (p as ZonePoint).y >= 0 &&
        (p as ZonePoint).y <= 1,
    )
  );
}

/**
 * The area-weighted centroid of the outline.
 *
 * Correct as a centroid, and NOT safe as a label anchor — a concave room
 * can have its centre of area outside its own walls. Use `zoneLabelPoint`
 * for anything that has to be drawn inside the room.
 *
 * Falls back to the vertex average for a degenerate outline (zero area),
 * which the formula cannot divide by.
 */
export function zoneCentroid(points: ZonePoint[]): ZonePoint {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };

  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }

  if (twiceArea === 0) {
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / n,
      y: points.reduce((sum, p) => sum + p.y, 0) / n,
    };
  }

  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/**
 * Where to put the room's label, guaranteed to be inside the room.
 *
 * The centroid is the obvious choice and is wrong for the exact shape this
 * feature exists to support. On an L-shaped living and dining space the
 * centre of area falls in the notch — measured, not assumed: the L used in
 * the tests centres at (0.404, 0.404), a whisker outside its own inner
 * corner. A label drawn there sits in the next room along.
 *
 * So the centroid is used when it is genuinely inside, and otherwise the
 * outline is cut by a horizontal line through it and the label goes in the
 * middle of the widest span of room that line crosses. That is the
 * standard cheap stand-in for the pole of inaccessibility, and for a
 * rectilinear floor plan it lands where a person would have put it.
 */
export function zoneLabelPoint(points: ZonePoint[]): ZonePoint {
  const centre = zoneCentroid(points);
  if (points.length < MIN_ZONE_POINTS || pointInZone(centre, points)) {
    return centre;
  }

  /*
    Every edge crossing of the horizontal line y = centre.y, in order. The
    polygon is closed, so these pair up into inside/outside spans: the
    first and second bound room, the third and fourth bound room, and the
    gap between the second and third is the notch.
  */
  const crossings: number[] = [];
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a.y > centre.y === b.y > centre.y) continue;
    crossings.push(((b.x - a.x) * (centre.y - a.y)) / (b.y - a.y) + a.x);
  }
  crossings.sort((p, q) => p - q);

  let best: ZonePoint = centre;
  let widest = -1;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1] - crossings[i];
    if (width > widest) {
      widest = width;
      best = { x: (crossings[i] + crossings[i + 1]) / 2, y: centre.y };
    }
  }
  return best;
}

/** Unsigned area of the outline, in fractions of the plan. */
export function zoneArea(points: ZonePoint[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Is the point inside the outline?
 *
 * Ray casting: count the edges a ray from the point crosses, odd means
 * inside. Handles concave rooms, which matters because an L-shaped living
 * and dining space is the common case this feature exists for.
 *
 * The inspector app needs the identical test for tap-to-open, so keep this
 * function and its app counterpart in step.
 */
export function pointInZone(point: ZonePoint, polygon: ZonePoint[]): boolean {
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

/**
 * The area a tap belongs to, when outlines overlap.
 *
 * Smallest wins. A plan often has a small room drawn on top of a larger
 * enclosing one (an ensuite inside a bedroom), and the inspector means the
 * one they can see, which is the one on top and smaller.
 */
export function zoneAt<T extends { zone?: ZonePoint[] | null }>(
  point: ZonePoint,
  areas: T[],
): T | null {
  let best: T | null = null;
  let bestArea = Infinity;
  for (const area of areas) {
    if (!area.zone || !isZone(area.zone)) continue;
    if (!pointInZone(point, area.zone)) continue;
    const size = zoneArea(area.zone);
    if (size < bestArea) {
      best = area;
      bestArea = size;
    }
  }
  return best;
}

/** Distance between two points, for "did they click the first vertex again". */
export function distance(a: ZonePoint, b: ZonePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** An SVG points attribute from an outline, scaled to a viewBox of 0..100. */
export function toSvgPoints(points: ZonePoint[]): string {
  return points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
}
