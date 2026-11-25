"use client";

import { useCallback } from "react";

import { useExpiredBookingApproval } from "./expired-booking-approval";
import { useLeadTimeConfirm } from "./lead-time-confirm";

/** What a booking sends once the user has answered: the lead time accepted, the approver's reason. */
export type BookingAnswers = { insideLeadTime?: boolean; expiredReason?: string | null };
export type BookingGuard = <T>(run: (answers: BookingAnswers) => Promise<T>) => Promise<T>;

/**
 * Both questions a booking may need (the server asks in this order): an
 * expired contract needs an approver's reason (DEV-496), then a day inside
 * the property's access lead time needs "book anyway" (DEV-493). Render
 * `dialogs`.
 */
export function useBookingGuards() {
  const expired = useExpiredBookingApproval();
  const lead = useLeadTimeConfirm();
  const { guard: expiredGuard } = expired;
  const { guard: leadGuard } = lead;
  const guard: BookingGuard = useCallback(
    <T,>(run: (answers: BookingAnswers) => Promise<T>) =>
      expiredGuard((expiredReason) =>
        leadGuard((insideLeadTime) => run({ ...(insideLeadTime ? { insideLeadTime: true } : {}), ...(expiredReason ? { expiredReason } : {}) })),
      ),
    [expiredGuard, leadGuard],
  );
  return {
    guard,
    dialogs: (
      <>
        {expired.dialog}
        {lead.dialog}
      </>
    ),
  };
}
