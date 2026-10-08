import type { VisitStatus } from "@/lib/amc/ppm";
import type { AccessStatus, CONFIRMATION_LABELS, SkillLevel } from "@/lib/amc/visits";

/**
 * How an AMC visit's states read on screen (Phase 8-9): the schedule tab,
 * the visit dialog and the technicians page share these. Theme tokens
 * only, the same scale as the rest of AMC.
 */

/* Tentative is muted, planned is brand, attention is amber, done is green. */
export function visitStatusTone(status: VisitStatus): string {
  switch (status) {
    case "scheduled":
      return "bg-brand-50 text-brand";
    case "confirmed":
      return "bg-brand-100 text-brand";
    case "in_progress":
    case "submitted":
      return "bg-brand-50 text-brand";
    case "completed":
    case "completed_with_additional_work":
      return "bg-success/10 text-success";
    case "rescheduled":
    case "pending_access":
    case "partially_completed":
      return "bg-warning/10 text-warning";
    case "not_completed":
      return "bg-danger/10 text-danger";
    case "cancelled":
      return "bg-mist text-ink-soft line-through";
    case "not_scheduled":
    default:
      return "bg-mist text-ink-soft";
  }
}

export type ConfirmationState = keyof typeof CONFIRMATION_LABELS;

export const CONFIRMATION_TONE: Record<ConfirmationState, string> = {
  pending: "bg-warning/10 text-warning",
  confirmed: "bg-success/10 text-success",
  declined: "bg-danger/10 text-danger",
  no_answer: "bg-danger/10 text-danger",
};

/* Short words for the schedule row's chip; the dialog uses CONFIRMATION_LABELS. */
export const CONFIRMATION_SHORT: Record<ConfirmationState, string> = {
  pending: "Awaiting client",
  confirmed: "Client confirmed",
  declined: "Client declined",
  no_answer: "No answer",
};

export const ACCESS_TONE: Record<AccessStatus, string> = {
  not_required: "bg-mist text-ink-soft",
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  expired: "bg-danger/10 text-danger",
};

export const SKILL_TONE: Record<SkillLevel, string> = {
  trainee: "bg-mist text-ink-soft",
  competent: "bg-brand-50 text-brand",
  expert: "bg-success/10 text-success",
};

export const CHANNELS = ["whatsapp", "call", "sms", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = { whatsapp: "WhatsApp", call: "Call", sms: "SMS", email: "Email" };
export const channelLabel = (c: string) => CHANNEL_LABELS[c as Channel] ?? c;

/* A placed slot is a timestamp; the board works in Dubai time. */
const DUBAI = "Asia/Dubai";
export const slotDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: DUBAI, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export const slotTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: DUBAI, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const slotDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: DUBAI, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

/** "Thu 12 Nov, 09:00–11:00". */
export function slotLabel(start: string, end: string | null): string {
  return `${slotDay(start)}, ${slotTime(start)}${end ? `–${slotTime(end)}` : ""}`;
}

/** "2 h 30 min", "45 min". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : null, m || !h ? `${m} min` : null].filter(Boolean).join(" ");
}
