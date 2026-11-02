// Manpower Compliance status engine (FRD FR-3, decision D7).
//
// Pure and dependency-free: it works on YYYY-MM-DD strings and a "today"
// string the caller supplies (from todayInZone() in lib/scheduling/org-time.ts,
// Asia/Dubai). Nothing here reads the machine clock, so the record view, the
// dashboard, the reminder list and the reminder job can never disagree, and
// the self-check script can pin "today" to 23 Oct 2026.
//
// Bands (Sharon, 26 Oct 2026): the expiry date itself is already expired.
//   days <= 0     expired
//   1 to 30       due_30
//   31 to 60      due_60
//   61 to 90      due_90
//   91 and up     valid
// Two extra states the workbook never had:
//   missing_expiry  held (or an identity document) with no date
//   not_held        a certificate the employee does not hold

export type ComplianceItemStatus =
  | "valid"
  | "due_90"
  | "due_60"
  | "due_30"
  | "expired"
  | "missing_expiry"
  | "not_held";

export type ItemStatusResult = {
  status: ComplianceItemStatus;
  /** Days to expiry; null when there is no date to count from. */
  days: number | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar days from `today` to `expiry` (both YYYY-MM-DD). Negative when past. */
export function daysToExpiry(expiry: string, today: string): number {
  if (!DATE_RE.test(expiry) || !DATE_RE.test(today)) {
    throw new Error("daysToExpiry expects YYYY-MM-DD strings");
  }
  return Math.round((utcMidnight(expiry) - utcMidnight(today)) / 86_400_000);
}

export function statusFromDays(days: number): ComplianceItemStatus {
  if (days <= 0) return "expired";
  if (days <= 30) return "due_30";
  if (days <= 60) return "due_60";
  if (days <= 90) return "due_90";
  return "valid";
}

/**
 * Emirates ID or passport. An identity document is never "not held": with no
 * expiry date on file it is missing, which the reminder list surfaces.
 */
export function identityStatus(expiry: string | null | undefined, today: string): ItemStatusResult {
  if (!expiry) return { status: "missing_expiry", days: null };
  const days = daysToExpiry(expiry, today);
  return { status: statusFromDays(days), days };
}

export type CertificateInput = {
  held: boolean;
  expiry: string | null | undefined;
  /** From the certificate type (D6). A non-expiring type is valid once held. */
  expires: boolean;
};

export function certificateStatus(input: CertificateInput, today: string): ItemStatusResult {
  if (!input.held) return { status: "not_held", days: null };
  if (!input.expires) return { status: "valid", days: null };
  if (!input.expiry) return { status: "missing_expiry", days: null };
  const days = daysToExpiry(input.expiry, today);
  return { status: statusFromDays(days), days };
}

/** Statuses that belong on the expiry reminder list (FR-7). */
export function isOnReminderList(status: ComplianceItemStatus): boolean {
  return status === "expired" || status === "due_30" || status === "due_60" || status === "due_90" || status === "missing_expiry";
}

/** Statuses that count as "held and in date" for training coverage (FR-5). */
export function isCurrentlyValid(status: ComplianceItemStatus): boolean {
  return status === "valid";
}
