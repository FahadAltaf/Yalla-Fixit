import { accessProblemText } from "./visits";
import type { PaymentTiming } from "./visit-charges";

/*
  Starting a call out or additional work (17 Nov 2026), as a planned visit
  is started: the office checks the crew, the time, the client (additional
  work only) and access, then starts it; only then can the crew attend or
  complete it on the phone.

  Call out: no client confirmation -- the client called and the visit was
  planned with them. An emergency needs only its crew and access (it is
  attended straight away; the time is when they get there).
*/

export type FieldStartKind = "call_out" | "additional_work";
export type FieldStartTab = "crew" | "client" | "access" | "services" | "payment";

export interface FieldStartCheck {
  key: "crew" | "time" | "client" | "access" | "services" | "payment";
  tab: FieldStartTab;
  label: string;
  ok: boolean;
  /** What to do when it is not ok. */
  text: string;
}

export interface FieldStartFacts {
  kind: FieldStartKind;
  /** The call out's priority (emergency: crew and access only). */
  priority?: string | null;
  technicianIds: string[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clientConfirmation?: string | null;
  accessStatus: string | null;
  /** A chargeable call out with no services priced yet (18 Nov 2026). */
  servicesMissing?: boolean;
  /**
   * Something to pay (18 Nov 2026): paid before the visit, or after it with
   * the reason. null when there is nothing to pay (covered, free, waived).
   */
  payment?: { paid: boolean; timing: PaymentTiming | null; reason: string | null } | null;
}

export const accessReady = (status: string | null) => status === "approved" || status === "not_required";

/** The checklist, in order; every item must be ok to start. */
export function fieldStartChecks(f: FieldStartFacts): FieldStartCheck[] {
  const emergency = f.kind === "call_out" && f.priority === "emergency";
  const checks: FieldStartCheck[] = [{ key: "crew", tab: "crew", label: "Crew chosen", ok: f.technicianIds.length > 0, text: "Choose the crew." }];
  if (!emergency) checks.push({ key: "time", tab: "crew", label: "Date and time set", ok: Boolean(f.scheduledStart && f.scheduledEnd), text: "Set the date and time." });
  if (f.kind === "additional_work") {
    checks.push({ key: "client", tab: "client", label: "Confirmed with the client", ok: f.clientConfirmation === "confirmed", text: "Confirm the day and time with the client." });
  }
  checks.push({ key: "access", tab: "access", label: "Access sorted", ok: accessReady(f.accessStatus), text: accessProblemText(f.accessStatus) });
  if (f.servicesMissing) {
    checks.push({ key: "services", tab: "services", label: "Services and price", ok: false, text: "Pick the services, so the client knows the price." });
  }
  if (f.payment) {
    const p = f.payment;
    const ok = p.paid || (p.timing === "after_visit" && Boolean(p.reason?.trim()));
    checks.push({
      key: "payment",
      tab: "payment",
      label: p.paid ? "Paid" : p.timing === "after_visit" ? "Payment after the visit" : "Payment before the visit",
      ok,
      text: p.timing === "after_visit" ? "Say why the client pays after the visit." : "Record the payment first, or choose after the visit with the reason.",
    });
  }
  return checks;
}

export const fieldStartProblems = (f: FieldStartFacts) => fieldStartChecks(f).filter((c) => !c.ok);

/** Statuses a call out or additional work can be started from. */
export const FIELD_STARTABLE: Record<FieldStartKind, readonly string[]> = {
  call_out: ["logged", "scheduled"],
  additional_work: ["scheduled"],
};

export const CLIENT_CONFIRMATIONS = ["pending", "confirmed", "declined"] as const;
export type ClientConfirmation = (typeof CLIENT_CONFIRMATIONS)[number];
export const CLIENT_CONFIRMATION_LABELS: Record<ClientConfirmation, string> = {
  pending: "Asked, waiting",
  confirmed: "Confirmed",
  declined: "Client declined",
};
