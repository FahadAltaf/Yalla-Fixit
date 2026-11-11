/**
 * AMC notifications: which events exist, who hears about each, on which
 * channel, and what the message says. No imports beyond the AMC rules:
 * usable from route handlers, components and tests.
 *
 * Delivery reuses what the portal already has: email through Resend
 * (lib/server/send-email.ts), and an in-app list on the AMC screens. Both
 * are recorded in `amc_notifications` (migration 20261006150000), whose
 * unique (dedupe key, channel, recipient) makes every send idempotent:
 * a retried client request, a double click or a second reminder sweep
 * writes nothing new.
 *
 * Recipients come from the workflow itself (the proposal owner, the AMC
 * approvers), never from guesswork. Where the business has not confirmed
 * recipients or a schedule (allowance alerts, expiry reminders), the event
 * is recorded in-app and its email is OFF by default
 * (amc_notification_settings).
 */
import { entitlementState, type ContractEntitlement } from "./contracts";

export const AMC_NOTIFICATION_EVENTS = [
  "proposal_submitted",
  "proposal_approved",
  "proposal_sent_back",
  "proposal_sent",
  "client_approved",
  "client_rejected",
  "contract_sent",
  "contract_signed",
  "contract_activated",
  "entitlement_low",
  "entitlement_exhausted",
  "contract_expiring",
  "renewal_created",
] as const;
export type AmcNotificationEvent = (typeof AMC_NOTIFICATION_EVENTS)[number];

export type AmcNotificationChannel = "in_app" | "email";
export type AmcAudience = "approvers" | "owner" | "owner_and_approvers";

/** Which switch in amc_notification_settings governs an event's email. */
export type EmailGate = "workflow" | "entitlement" | "reminder" | "never";

export interface AmcEventPolicy {
  audience: AmcAudience;
  /** Email is sent only when this gate is on (and always in-app). */
  emailGate: EmailGate;
  /** When the person who caused the event is also a recipient, skip them. */
  skipActor: boolean;
}

/**
 * IN-APP for every event; EMAIL where the portal already emails for the
 * same kind of moment (an approval waiting, a decision made). Sending a
 * document is the owner's own action: in-app only, and only when someone
 * else sent it.
 */
export const AMC_EVENT_POLICY: Record<AmcNotificationEvent, AmcEventPolicy> = {
  proposal_submitted: { audience: "approvers", emailGate: "workflow", skipActor: true },
  proposal_approved: { audience: "owner", emailGate: "workflow", skipActor: true },
  proposal_sent_back: { audience: "owner", emailGate: "workflow", skipActor: true },
  proposal_sent: { audience: "owner", emailGate: "never", skipActor: true },
  client_approved: { audience: "owner", emailGate: "workflow", skipActor: false },
  client_rejected: { audience: "owner", emailGate: "workflow", skipActor: false },
  contract_sent: { audience: "owner", emailGate: "never", skipActor: true },
  contract_signed: { audience: "owner_and_approvers", emailGate: "workflow", skipActor: false },
  contract_activated: { audience: "owner", emailGate: "workflow", skipActor: true },
  entitlement_low: { audience: "owner", emailGate: "entitlement", skipActor: false },
  entitlement_exhausted: { audience: "owner", emailGate: "entitlement", skipActor: false },
  contract_expiring: { audience: "owner", emailGate: "reminder", skipActor: false },
  renewal_created: { audience: "owner", emailGate: "never", skipActor: true },
};

export interface AmcNotificationSettings {
  workflowEmailEnabled: boolean;
  entitlementEmailEnabled: boolean;
  reminderAutoEnabled: boolean;
  reminderThresholds: number[];
  reminderRecipients: Array<"owner" | "approvers">;
  reminderChannels: AmcNotificationChannel[];
  reminderExtraEmails: string[];
}

/** The migration's defaults: also what the code uses before it is applied. */
export const AMC_NOTIFICATION_DEFAULTS: AmcNotificationSettings = {
  workflowEmailEnabled: true,
  entitlementEmailEnabled: false,
  reminderAutoEnabled: false,
  reminderThresholds: [60, 30, 15],
  reminderRecipients: ["owner"],
  reminderChannels: ["in_app"],
  reminderExtraEmails: [],
};

/** Whether this event's email goes out under these settings. */
export function emailEnabledFor(event: AmcNotificationEvent, settings: AmcNotificationSettings): boolean {
  switch (AMC_EVENT_POLICY[event].emailGate) {
    case "workflow":
      return settings.workflowEmailEnabled;
    case "entitlement":
      return settings.entitlementEmailEnabled;
    case "reminder":
      return settings.reminderChannels.includes("email");
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Dedupe keys                                                         */
/* ------------------------------------------------------------------ */

/**
 * One notification per real-world occurrence. Workflow events that can
 * legitimately happen again (a proposal resubmitted after being sent back)
 * carry the moment it happened, so each round notifies once; state events
 * (an allowance running low) carry only the state.
 */
export function dedupeKey(
  event: AmcNotificationEvent,
  parts: { submissionId?: string | null; contractId?: string | null; entitlementId?: string | null; at?: string | null; threshold?: number | null },
): string {
  const subject = parts.entitlementId ?? parts.contractId ?? parts.submissionId ?? "none";
  const extra = parts.threshold != null ? `:${parts.threshold}` : parts.at ? `:${parts.at}` : "";
  return `${event}:${subject}${extra}`;
}

/* ------------------------------------------------------------------ */
/* Allowance alerts                                                    */
/* ------------------------------------------------------------------ */

/**
 * The alert an allowance is in after a usage entry, or null. Unlimited and
 * informational services never alert; only visits and hours with an
 * allowance do. "Low" is at most the low-remaining share left (25% by
 * default, LOW_REMAINING_FRACTION); "exhausted" is nothing left.
 */
export function entitlementAlert(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
): "entitlement_low" | "entitlement_exhausted" | null {
  if (e.entitlementType !== "visits" && e.entitlementType !== "hours") return null;
  if ((e.includedQuantity ?? 0) <= 0) return null;
  const state = entitlementState(e, "active");
  if (state === "exhausted") return "entitlement_exhausted";
  if (state === "low_remaining") return "entitlement_low";
  return null;
}

/* ------------------------------------------------------------------ */
/* Expiry thresholds                                                   */
/* ------------------------------------------------------------------ */

/**
 * The reminder thresholds that are due today for a contract ending on
 * `endDate`: every threshold whose reminder day has arrived while the
 * contract has not yet ended. A threshold that was missed (the sweep did
 * not run that day) is still due, once.
 */
export function dueExpiryThresholds(endDate: string, today: string, thresholds: ReadonlyArray<number>): number[] {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(now) || now > end) return [];
  const daysLeft = Math.round((end - now) / 86_400_000);
  return [...new Set(thresholds)]
    .filter((t) => Number.isInteger(t) && t > 0 && daysLeft <= t)
    .sort((a, b) => b - a);
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export interface AmcNotificationFacts {
  proposalNumber?: string | null;
  customerName?: string | null;
  propertyLabel?: string | null;
  actorName?: string | null;
  reason?: string | null;
  signedByName?: string | null;
  signedAt?: string | null;
  serviceLabel?: string | null;
  remaining?: number | null;
  unit?: string | null;
  endDate?: string | null;
  daysLeft?: number | null;
}

export interface AmcMessage {
  title: string;
  body: string;
}

/** A Dubai date-and-time for messages, e.g. "6 Oct 2026, 14:05". */
export function dubaiDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  });
}

/**
 * The words of each notification. Internal only: nothing here is ever
 * sent to a client, and no token or link to the client page is included.
 */
export function amcMessage(event: AmcNotificationEvent, f: AmcNotificationFacts): AmcMessage {
  const ref = f.proposalNumber || "An AMC proposal";
  const who = f.customerName ? ` for ${f.customerName}` : "";
  const where = f.propertyLabel ? ` (${f.propertyLabel})` : "";
  const by = f.actorName ? ` by ${f.actorName}` : "";
  switch (event) {
    case "proposal_submitted":
      return { title: `${ref} needs your approval`, body: `${ref}${who}${where} was submitted for approval${by}.` };
    case "proposal_approved":
      return { title: `${ref} was approved`, body: `${ref}${who} was approved${by}. It can now be sent to the client.` };
    case "proposal_sent_back":
      return {
        title: `${ref} was sent back`,
        body: `${ref}${who} was sent back${by}.${f.reason ? ` Reason: ${f.reason}` : ""}`,
      };
    case "proposal_sent":
      return { title: `${ref} was sent to the client`, body: `${ref}${who} was sent to the client${by}.` };
    case "client_approved":
      return {
        title: `${ref}: the client approved the proposal`,
        body: `${f.signedByName || "The client"} approved ${ref}${who}${where}. The contract can now be sent for signature.`,
      };
    case "client_rejected":
      return {
        title: `${ref}: the client rejected the proposal`,
        body: `${f.signedByName || "The client"} rejected ${ref}${who}${where}.${f.reason ? ` Reason given: ${f.reason}` : ""}`,
      };
    case "contract_sent":
      return { title: `${ref}: contract sent for signature`, body: `The contract for ${ref}${who} was sent for signature${by}.` };
    case "contract_signed":
      return {
        title: `${ref}: contract signed`,
        body:
          `The contract for ${ref}${who}${where} was signed online` +
          (f.signedByName ? ` by ${f.signedByName} (typed name)` : "") +
          (f.signedAt ? ` on ${dubaiDateTime(f.signedAt)} UAE time` : "") +
          ". It is ready to activate.",
      };
    case "contract_activated":
      return { title: `${ref}: AMC activated`, body: `The AMC for ${ref}${who}${where} was activated${by}.` };
    case "entitlement_low":
      return {
        title: `${ref}: ${f.serviceLabel ?? "a service"} is running low`,
        body: `${f.serviceLabel ?? "A service"} on ${ref}${who} has ${f.remaining ?? 0} ${f.unit ?? ""} left.`.replace(/\s+\./, "."),
      };
    case "entitlement_exhausted":
      return {
        title: `${ref}: ${f.serviceLabel ?? "a service"} is used up`,
        body: `${f.serviceLabel ?? "A service"} on ${ref}${who} has no allowance left. Further work is chargeable.`,
      };
    case "contract_expiring":
      return {
        title: `${ref}: AMC ends in ${f.daysLeft ?? "?"} days`,
        body: `The AMC for ${ref}${who}${where} ends on ${f.endDate ?? "its end date"}. Start the renewal from AMC contracts.`,
      };
    case "renewal_created":
      return { title: `${ref}: renewal proposal started`, body: `A renewal proposal was started for ${ref}${who}${by}.` };
  }
}
