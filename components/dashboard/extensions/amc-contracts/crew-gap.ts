import type { VisitSuggestion } from "@/modules/amc-contracts/visits-service";

import { TRADE_LABELS } from "@/lib/amc/client-profile";

/**
 * Why no crew covers a trade, in words: nobody on the roster, nobody with
 * the trade on their AMC profile (the usual reason: skills are recorded
 * under Workforce → People → AMC skills), or everyone who has it is busy or away.
 */
export function crewGapMessages(s: Pick<VisitSuggestion, "suggested" | "skilledByTrade" | "rosterSize">): string[] {
  if (!s.suggested.uncovered.length) return [];
  if (s.rosterSize === 0) return ["No active technicians on the FSM roster. Sync the technicians from Zoho FSM first."];
  const label = (t: string) => TRADE_LABELS[t as keyof typeof TRADE_LABELS] ?? t;
  const none = s.suggested.uncovered.filter((t) => (s.skilledByTrade?.[t] ?? 0) === 0);
  const busy = s.suggested.uncovered.filter((t) => (s.skilledByTrade?.[t] ?? 0) > 0);
  return [
    ...(none.length
      ? [`Nobody has ${none.map(label).join(", ")} on their AMC profile, so there is no suggestion. Any technician below can still be picked (no skill restriction for AMC work).`]
      : []),
    ...busy.map((t) => `The ${s.skilledByTrade[t]} technician${s.skilledByTrade[t] === 1 ? "" : "s"} with ${label(t)} ${s.skilledByTrade[t] === 1 ? "is" : "are"} booked or away at that time, so there is no suggestion. Pick another technician, or one marked Already booked.`),
  ];
}
