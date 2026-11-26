import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Banknote,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  ClipboardCheck,
  FilePen,
  FileSignature,
  FileText,
  Gauge,
  Hammer,
  Hourglass,
  Inbox,
  KeyRound,
  ListTodo,
  Mail,
  MapPin,
  MessageSquare,
  PauseCircle,
  PenLine,
  PhoneCall,
  PhoneMissed,
  PlayCircle,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Undo2,
  UserCheck,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Each notification's icon and tone, from its event (26 Nov 2026, the user).
 * Green: good news (approved, signed, activated, closed). Amber: needs
 * attention (due, overdue, at risk, expiring, escalated). Red: something
 * went wrong (failed, bounced, rejected). Otherwise neutral. An event added
 * later still gets an icon from its area, or the bell.
 */
type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  good: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  bad: "bg-danger/10 text-danger",
  neutral: "bg-muted text-muted-foreground",
};

/* Exact events first, then by area. */
const EXACT: Record<string, [LucideIcon, Tone]> = {
  "finance.digest": [Mail, "neutral"],
  "finance.query_raised": [MessageSquare, "warn"],
  "finance.put_on_hold": [PauseCircle, "warn"],
  "finance.resumed": [PlayCircle, "good"],
  "finance.item_aged": [Hourglass, "warn"],
  "finance.marked_invoiceable": [ReceiptText, "good"],
  "finance.marked_not_invoiceable": [ReceiptText, "neutral"],
  "finance.exclusion_requested": [ReceiptText, "warn"],
  contract_creation_failed: [AlertTriangle, "bad"],
  contract_signature_needed: [PenLine, "warn"],
  contract_signed: [PenLine, "good"],
  contract_unsigned: [PenLine, "warn"],
  contract_activated: [CheckCircle2, "good"],
  contract_expiring: [CalendarClock, "warn"],
  contract_sent: [FileText, "neutral"],
  renewal_created: [RefreshCw, "neutral"],
  renewal_due: [RefreshCw, "warn"],
  renewal_idle: [RefreshCw, "warn"],
  client_approved: [CheckCircle2, "good"],
  client_rejected: [XCircle, "bad"],
  proposal_approved: [ShieldCheck, "good"],
  proposal_level_approved: [ShieldCheck, "good"],
  proposal_sent_back: [Undo2, "warn"],
  proposal_validity_expiring: [Hourglass, "warn"],
  entitlement_low: [Gauge, "warn"],
  entitlement_exhausted: [Gauge, "bad"],
  cheque_bounced: [AlertTriangle, "bad"],
  cheque_date_near: [Banknote, "warn"],
  initial_payment_late: [Banknote, "bad"],
  instalment_overdue: [Banknote, "bad"],
  ppm_overdue: [CalendarX, "warn"],
  visit_no_answer: [PhoneMissed, "warn"],
  visit_access_pending: [KeyRound, "warn"],
  visit_closed: [CheckCircle2, "good"],
  call_out_sla_at_risk: [AlertTriangle, "warn"],
  job_sheet_returned: [Undo2, "warn"],
  job_sheet_not_submitted: [ClipboardCheck, "warn"],
  service_report_at_risk: [ClipboardCheck, "warn"],
  site_visit_approved: [MapPin, "good"],
  site_visit_sent_back: [Undo2, "warn"],
  todo_escalated: [ListTodo, "warn"],
  enquiry_escalated: [Inbox, "warn"],
  enquiry_idle: [Inbox, "warn"],
  amendment_requested: [FilePen, "neutral"],
  reviewer_assigned: [UserCheck, "neutral"],
  approval_manager_assigned: [UserCheck, "neutral"],
};

const AREAS: Array<[RegExp, LucideIcon]> = [
  [/^finance\./, Banknote],
  [/^(instalment|payment|initial_payment|cheque)/, Banknote],
  [/^(proposal|client_)/, FileSignature],
  [/^(contract|renewal)/, FileText],
  [/^entitlement/, Gauge],
  [/^(ppm|visit)/, CalendarCheck],
  [/^call_out/, PhoneCall],
  [/^(job_sheet|service_report)/, ClipboardCheck],
  [/^site_visit/, MapPin],
  [/^enquiry/, Inbox],
  [/^todo/, ListTodo],
  [/^additional_work/, Hammer],
  [/^amendment/, FilePen],
];

export function notificationLook(event: string): { icon: LucideIcon; tone: Tone } {
  const exact = EXACT[event];
  if (exact) return { icon: exact[0], tone: exact[1] };
  const area = AREAS.find(([re]) => re.test(event));
  /* Words in the event name still say how urgent it is. */
  const tone: Tone = /(failed|bounced|rejected|exhausted|missed)/.test(event)
    ? "bad"
    : /(due|overdue|late|risk|expiring|escalated|pending|idle|awaiting|to_approve|returned|sent_back)/.test(event)
      ? "warn"
      : /(approved|signed|activated|closed|resumed)/.test(event)
        ? "good"
        : "neutral";
  return { icon: area?.[1] ?? Bell, tone };
}

/** The notification's icon in a small tinted tile. */
export function NotificationIcon({ event, className }: { event: string; className?: string }) {
  const { icon: Icon, tone } = notificationLook(event);
  return (
    <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", TONE_CLASS[tone], className)}>
      <Icon />
    </span>
  );
}
