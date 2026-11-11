import type { VisitSuggestion } from "@/modules/amc-contracts/visits-service";

import { TRADE_LABELS } from "@/lib/amc/client-profile";

/**
 * Why no crew covers a trade, in words: nobody on the roster, nobody with
 * the trade on their AMC profile (the usual reason: skills are recorded
 * under AMC → Technicians), or everyone who has it is busy or away.
 */
export function crewGapMessages(s: Pick<VisitSuggestion, "suggested" | "skilledByTrade" | "rosterSize">): string[] {
  if (!s.suggested.uncovered.length) return [];
  if (s.rosterSize === 0) return ["No active technicians on the FSM roster. Sync the technicians from Zoho FSM first."];
  const label = (t: string) => TRADE_LABELS[t as keyof typeof TRADE_LABELS] ?? t;
  const none = s.suggested.uncovered.filter((t) => (s.skilledByTrade?.[t] ?? 0) === 0);
  const busy = s.suggested.uncovered.filter((t) => (s.skilledByTrade?.[t] ?? 0) > 0);
  return [
    ...(none.length
      ? [`No technician has ${none.map(label).join(", ")} confirmed on their AMC profile (trainee or expired certificate does not count). Add the skill under AMC → Technicians.`]
      : []),
    ...busy.map((t) => `All ${s.skilledByTrade[t]} technician${s.skilledByTrade[t] === 1 ? "" : "s"} with ${label(t)} are booked, on leave or lack the site's access at that time. Try another time or day.`),
  ];
}
