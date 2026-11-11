import { Badge } from "@/components/ui/badge";
import {
  CHEQUE_STATUS_LABELS,
  INSTALMENT_STATUS_LABELS,
  SETTLED_STATUSES,
  type ChequeStatus,
  type InstalmentStatus,
} from "@/lib/amc/payments";

/**
 * How AMC payment states look (Phase 7), shared by the contract's Payments
 * tab, the client's and Finance's page. Theme tokens only: waiting is
 * warning, money in is success, late or bounced is danger, a cheque on its
 * way is brand, and anything closed by a person is neutral.
 */
const INSTALMENT_TONE: Record<InstalmentStatus, string> = {
  not_due: "bg-mist text-ink-soft",
  due: "bg-warning/10 text-warning",
  partially_received: "bg-brand-50 text-brand",
  received: "bg-success/10 text-success",
  overdue: "bg-danger/10 text-danger",
  cheque_deposited: "bg-brand-100 text-brand",
  bounced: "bg-danger/10 text-danger",
  written_off: "bg-mist text-ink-soft",
  waived: "bg-mist text-ink-soft",
};

const CHEQUE_TONE: Record<ChequeStatus, string> = {
  held: "bg-mist text-ink-soft",
  deposited: "bg-brand-50 text-brand",
  cleared: "bg-success/10 text-success",
  bounced: "bg-danger/10 text-danger",
  replaced: "bg-mist text-ink-soft",
  returned: "bg-mist text-ink-soft",
};

export function InstalmentStatusBadge({ status }: { status: InstalmentStatus }) {
  return (
    <Badge variant="secondary" className={`border-0 font-medium ${INSTALMENT_TONE[status] ?? "bg-mist text-ink-soft"}`}>
      {INSTALMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function ChequeStatusBadge({ status }: { status: ChequeStatus }) {
  return (
    <Badge variant="secondary" className={`border-0 font-medium ${CHEQUE_TONE[status] ?? "bg-mist text-ink-soft"}`}>
      {CHEQUE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** Nothing more is expected from it: received, written off or waived. */
export const isSettled = (status: InstalmentStatus) => SETTLED_STATUSES.includes(status);

/** "12 days", or an em dash when nothing is late. */
export function DaysOverdue({ days }: { days: number }) {
  if (!days || days <= 0) return <span className="text-muted-foreground">—</span>;
  return <span className="text-danger font-medium tabular-nums">{days === 1 ? "1 day" : `${days} days`}</span>;
}
