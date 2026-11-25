/*
  A booking on an expired contract (DEV-496, BRD v0.4 5.16: "A booking on
  an expired contract shows a warning, needs an approval and is logged").
  A PPM visit placed or moved, a call out logged or additional work raised
  on a contract past its end is refused unless an AMC approver books it
  with a reason; each one is written to the contract's history.
*/

/** Starts the API's 409 answer, so the screens ask the approver for the reason. */
export const EXPIRED_BOOKING_MARK = "The contract has expired";
/** Starts the API's 403 answer for someone who may not approve it. */
export const EXPIRED_BOOKING_REFUSED = "Only an AMC approver can book on an expired contract";

/** Expired on `day`: its status says so, or it is still marked live but its end date has passed. */
export function contractExpiredOn(contract: { status: string; endDate: string | null | undefined }, day: string): boolean {
  if (contract.status === "expired") return true;
  return ["active", "on_hold"].includes(contract.status) && Boolean(contract.endDate) && String(contract.endDate) < day;
}

export const isExpiredBookingWarning = (message: string | null | undefined) => Boolean(message?.startsWith(EXPIRED_BOOKING_MARK));
