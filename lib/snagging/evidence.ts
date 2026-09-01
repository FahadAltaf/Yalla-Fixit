import type { SnaggingPhoto } from "@/types/types";

/**
 * Which visit a piece of evidence belongs to.
 *
 * A de-snag round carries the defect's original photo forward and adds its
 * own, so one snag row on a round holds both halves of "was this fixed?".
 * They were rendered as one undifferentiated pile, which is the one thing
 * that makes the pair useless: a reviewer could not tell the shot of the
 * broken handle from the shot of the repaired one, and the report printed
 * them in whatever order they were uploaded.
 *
 * `round_number` is what separates them — it records the visit the shutter
 * was pressed on, not the visit the row now hangs off.
 */
export type Evidence = {
  /** Shot on an earlier visit: the defect as it was raised. */
  before: SnaggingPhoto[];
  /** Shot on this visit: the state the inspector found it in. */
  after: SnaggingPhoto[];
};

/**
 * Splits a snag's photos into before and after for the visit viewing them.
 *
 * On the original inspection there is no "before" — every photo was taken
 * on that visit — so everything lands in `after` and the caller shows it as
 * a plain evidence list.
 */
export function splitEvidence(
  photos: SnaggingPhoto[] | null | undefined,
  visitRound: number,
): Evidence {
  const before: SnaggingPhoto[] = [];
  const after: SnaggingPhoto[] = [];

  for (const photo of photos ?? []) {
    // A photo with no round recorded predates the column; it belongs to
    // the visit that raised the defect, which is the earliest one there is.
    const shotOn = photo.round_number ?? 1;
    if (shotOn < visitRound) before.push(photo);
    else after.push(photo);
  }

  const byTime = (a: SnaggingPhoto, b: SnaggingPhoto) =>
    new Date(a.taken_at ?? 0).getTime() - new Date(b.taken_at ?? 0).getTime();

  return { before: before.sort(byTime), after: after.sort(byTime) };
}

/**
 * The one photo that represents a snag in a list.
 *
 * On a round that is the newest AFTER shot when there is one — the current
 * state of the defect is what a reviewer scanning the list wants — falling
 * back to the before shot so a defect nobody has re-photographed still
 * shows as something rather than as an empty square.
 */
export function coverPhoto(evidence: Evidence): SnaggingPhoto | null {
  const usable = (list: SnaggingPhoto[]) => list.filter((p) => p.signed_url);
  const after = usable(evidence.after);
  if (after.length > 0) return after[after.length - 1];
  const before = usable(evidence.before);
  return before.length > 0 ? before[before.length - 1] : null;
}
