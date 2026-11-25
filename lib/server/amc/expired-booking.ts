import type { SupabaseClient } from "@supabase/supabase-js";

import { EXPIRED_BOOKING_MARK, EXPIRED_BOOKING_REFUSED, contractExpiredOn } from "@/lib/amc/expired-booking";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";

type Admin = SupabaseClient;

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * DEV-496: a booking on `day` against an expired contract. Not expired:
 * false, nothing asked. Expired: an AMC approver (canApprove) books it with
 * a reason, which is logged on the contract; anyone else is refused (403),
 * and an approver without a reason is asked for one (409,
 * EXPIRED_BOOKING_MARK). True when it was booked on an expired contract.
 */
export async function approveExpiredBooking(
  admin: Admin,
  input: {
    contract: { id: string; status: string; endDate: string | null | undefined; number?: string | null };
    day: string;
    /** "PPM visit 3 placed", "Call out logged", "Additional work raised". */
    what: string;
    reason?: string | null;
    canApprove: boolean;
  },
  actor: { id: string | null; label: string | null },
): Promise<boolean> {
  if (!contractExpiredOn(input.contract, input.day)) return false;
  const ended = input.contract.endDate ? ` on ${fmt(String(input.contract.endDate))}` : "";
  if (!input.canApprove) throw new ContractError(`${EXPIRED_BOOKING_REFUSED}: ${input.contract.number || "this contract"} ended${ended}. Ask an approver, or renew the contract.`, 403);
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) throw new ContractError(`${EXPIRED_BOOKING_MARK}${ended}: as an AMC approver you can book on it anyway; say why. It is logged on the contract.`, 409);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: input.contract.id,
    eventType: "booking_on_expired_contract",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: reason,
    payload: { what: input.what, day: input.day, endDate: input.contract.endDate ?? null, approvedBy: actor.label },
  });
  return true;
}
