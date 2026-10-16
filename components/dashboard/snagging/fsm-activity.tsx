"use client";

import {
  Ban,
  Building2,
  Calculator,
  CheckCircle2,
  FilePlus2,
  FileText,
  FileUp,
  Hash,
  ListChecks,
  MapPin,
  Paperclip,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  UserPlus,
  UserRound,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { DataRow } from "@/components/dashboard/shared/kaizen";
import { cn } from "@/lib/utils";
import type { SnaggingQuotationFsm } from "@/modules/snagging";

import { ListPager, ListSkeleton, formatLocalDateTime } from "./shared";

/** What each logged FSM call is called on screen, and its icon. */
const ACTION_META: Record<string, { label: string; Icon: LucideIcon }> = {
  contact_search: { label: "Client looked up in FSM", Icon: UserRound },
  contact_link: { label: "Client linked to FSM", Icon: UserRound },
  contact_create: { label: "Client created in FSM", Icon: UserPlus },
  contact_update: { label: "Client updated in FSM", Icon: Pencil },
  company_create: { label: "Company created in FSM", Icon: Building2 },
  address_create: { label: "Address added in FSM", Icon: MapPin },
  address_update: { label: "Address updated in FSM", Icon: MapPin },
  services_lookup: { label: "FSM services found", Icon: ListChecks },
  estimate_build: { label: "Estimate prepared", Icon: FileText },
  estimate_create: { label: "Estimate created", Icon: FilePlus2 },
  estimate_update: { label: "Estimate updated", Icon: Pencil },
  number_adopt: { label: "Quotation numbered as FSM", Icon: Hash },
  estimate_cancel: { label: "Earlier estimate cancelled", Icon: Ban },
  estimate_revision: { label: "Revised estimate created", Icon: RotateCcw },
  estimate_mark_as_sent: { label: "Estimate marked sent", Icon: Send },
  estimate_approve: { label: "Estimate approved", Icon: CheckCircle2 },
  estimate_reject: { label: "Estimate rejected", Icon: XCircle },
  total_check: { label: "Totals compared", Icon: Calculator },
  work_order_build: { label: "Work order prepared", Icon: Wrench },
  work_order_convert: { label: "Estimate converted to work order", Icon: RotateCcw },
  work_order_create: { label: "Work order created", Icon: Wrench },
  work_order_unlinked: { label: "Created without the estimate link", Icon: Wrench },
  work_order_update: { label: "Work order updated", Icon: Pencil },
  work_order_complete: { label: "Work order completion", Icon: CheckCircle2 },
  report_upload: { label: "Report uploaded", Icon: FileUp },
  report_attach: { label: "Report attached", Icon: Paperclip },
  job_sync: { label: "Sync", Icon: RefreshCw },
  sync: { label: "Sync", Icon: RefreshCw },
};

const metaFor = (action: string) =>
  ACTION_META[action] ?? { label: action.replace(/_/g, " "), Icon: RefreshCw };

/**
 * One page of Zoho FSM calls, newest first, in the same rows and pager as
 * the job's History: what was done, who did it, Zoho's answer, and when.
 * Paged on the server: the caller asks for the page and hands it here.
 */
export function FsmEventList({
  log,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  log: SnaggingQuotationFsm["log"];
  total: number;
  page: number;
  pageSize: number;
  /** The page asked for has not arrived yet. */
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
}) {
  if (!loading && total === 0) {
    return (
      <p className={cn("text-muted-foreground p-5 text-sm", className)}>
        Nothing has been sent to Zoho FSM yet.
      </p>
    );
  }
  return (
    <div className={className}>
      {loading ? (
        <ListSkeleton rows={Math.min(pageSize, 4)} />
      ) : (
        <ol className="divide-y">
          {log.map((entry) => {
            const { label, Icon } = metaFor(entry.action);
            const failed = entry.status === "failed";
            const skipped = entry.status === "skipped";
            return (
              <li key={entry.id}>
                <DataRow
                  icon={
                    <Icon aria-hidden className={cn(failed && "text-destructive", skipped && "text-warning")} />
                  }
                  title={
                    <>
                      {label}
                      {failed ? <span className="text-destructive"> · failed</span> : null}
                      {skipped ? <span className="text-warning"> · not done</span> : null}
                    </>
                  }
                  subtitle={
                    <>
                      {entry.actor?.full_name ?? entry.actor?.email ?? "System"}
                      {entry.message ? <span> · {entry.message}</span> : null}
                    </>
                  }
                  trailing={
                    <span className="text-muted-foreground text-xs">{formatLocalDateTime(entry.created_at)}</span>
                  }
                />
              </li>
            );
          })}
        </ol>
      )}
      {total > 0 ? (
        <ListPager
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={(size) => {
            onPageSizeChange(size);
            onPageChange(0);
          }}
          noun="events"
          className="border-t"
        />
      ) : null}
    </div>
  );
}
