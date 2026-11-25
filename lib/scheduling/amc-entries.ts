/**
 * AMC work on the Scheduling board (DEV-489, 25 Nov 2026): an entry tagged
 * AMC shows an AMC visit, call out or additional work. It is changed in AMC,
 * where the service window, crew checks and the job's history are, and the
 * board shows it read only. It is never sent to FSM.
 */

export type AmcEntryKind = "ppm" | "call_out" | "additional_work";

export const AMC_ENTRY_READ_ONLY = "This is AMC work: change or remove it in AMC (Open in AMC on the entry). The board follows.";

/** Where the entry's AMC record opens in the portal. */
export function amcEntryHref(kind: string | null | undefined, id: string | null | undefined): string | null {
  if (!kind || !id) return null;
  if (kind === "additional_work") return `/extensions/amc-contracts/additional-works/${id}`;
  /* PPM visits and call outs both open on the visit page. */
  return `/extensions/amc-contracts/visits/${id}`;
}

export const AMC_KIND_LABELS: Record<AmcEntryKind, string> = {
  ppm: "PPM visit",
  call_out: "Call out",
  additional_work: "Additional work",
};
