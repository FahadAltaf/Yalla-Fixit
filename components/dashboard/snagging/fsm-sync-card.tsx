"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { snaggingService, type SnaggingQuotationFsm } from "@/modules/snagging";

import { SubmitButton, formatLocalDateTime } from "./shared";

/** What each logged FSM call is called on screen. */
const ACTION_LABEL: Record<string, string> = {
  contact_search: "Client looked up",
  contact_link: "Client linked",
  contact_create: "Client created",
  company_create: "Company created",
  estimate_build: "Quotation prepared",
  estimate_create: "Quotation created",
  estimate_update: "Quotation updated",
  estimate_cancel: "Earlier quotation cancelled",
  estimate_revision: "Revised quotation created",
  estimate_mark_as_sent: "Marked as sent",
  estimate_approve: "Approved",
  estimate_reject: "Rejected",
  total_check: "Totals compared",
  services_lookup: "FSM services found",
  work_order_build: "Job prepared",
  work_order_create: "Work order created",
  work_order_complete: "Work order completed",
  report_upload: "Report uploaded",
  report_attach: "Report attached",
  job_sync: "Sync",
  sync: "Sync",
};

/**
 * The quotation in Zoho FSM (YFI Snagging - Zoho FSM APIs for Quotations):
 * the FSM estimate it is mirrored as, where the sync stands, why it failed
 * if it did, a Retry, and every call the sync made (SNG-191).
 *
 * `refreshKey` changes when the quotation changes on this page, so the card
 * reads again after an action (the sync runs just after it answers).
 */
export function FsmSyncCard({
  quotationId,
  canEdit,
  refreshKey,
}: {
  quotationId: string;
  canEdit: boolean;
  refreshKey?: unknown;
}) {
  const [state, setState] = useState<SnaggingQuotationFsm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await snaggingService.getQuotationFsm(quotationId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the FSM sync");
    }
  }, [quotationId]);

  useEffect(() => {
    void load();
    // The sync runs just after an action answers: read again shortly after.
    const later = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(later);
  }, [load, refreshKey]);

  async function retry() {
    setRetrying(true);
    try {
      const result = await snaggingService.syncQuotationFsm(quotationId);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The FSM sync failed");
    } finally {
      setRetrying(false);
      void load();
    }
  }

  const quote = state?.quotation ?? null;
  const badge = !state
    ? null
    : !state.enabled
      ? { label: "Sync off", tone: "bg-muted text-muted-foreground" }
      : !state.ready
        ? { label: "Not set up", tone: "bg-muted text-muted-foreground" }
        : quote?.fsm_error
          ? { label: "Failed", tone: "bg-destructive/10 text-destructive" }
          : quote?.fsm_estimate_id
            ? { label: "Synced", tone: "bg-success/10 text-success" }
            : { label: "Not synced", tone: "bg-warning/10 text-warning" };

  return (
    <SectionCard
      title="Zoho FSM"
      icon={<CloudUpload />}
      description="The quotation as an estimate in Zoho FSM."
      action={badge ? <Badge className={`border-0 ${badge.tone}`}>{badge.label}</Badge> : null}
      bodyClassName="border-t px-5 py-4"
    >
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !state ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !state.enabled ? (
        <p className="text-muted-foreground text-sm">
          Syncing with Zoho FSM is switched off. It starts once SNAGGING_FSM_SYNC is set
          to &quot;on&quot;.
        </p>
      ) : !state.ready ? (
        <p className="text-muted-foreground text-sm">
          The Zoho FSM sync needs its database migration applied first.
        </p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Estimate</dt>
            <dd className="font-medium">{quote?.fsm_estimate_number ?? quote?.fsm_estimate_id ?? "Not created yet"}</dd>
            <dt className="text-muted-foreground">FSM status</dt>
            <dd>{quote?.fsm_status ?? "—"}</dd>
            <dt className="text-muted-foreground">Last synced</dt>
            <dd>{quote?.fsm_synced_at ? formatLocalDateTime(quote.fsm_synced_at) : "—"}</dd>
          </dl>

          {quote?.fsm_error ? (
            <div className="bg-destructive/5 border-destructive/20 flex gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
              <p className="break-words">{quote.fsm_error}</p>
            </div>
          ) : null}

          {canEdit ? (
            <SubmitButton
              variant="outline"
              size="sm"
              onClick={() => void retry()}
              pending={retrying}
              pendingLabel="Syncing…"
              icon={<RefreshCw className="size-4" />}
            >
              {quote?.fsm_error ? "Retry" : "Sync now"}
            </SubmitButton>
          ) : null}

          <FsmLogList log={state.log} />
        </div>
      )}
    </SectionCard>
  );
}

/** The FSM sync log, newest first: what each call did, or why it failed. */
export function FsmLogList({ log }: { log: SnaggingQuotationFsm["log"] }) {
  if (log.length === 0) return null;
  return (
    <ol className="space-y-3 border-t pt-4">
      {log.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <span
            aria-hidden
            className={
              entry.status === "failed"
                ? "bg-destructive mt-1.5 size-2 shrink-0 rounded-full"
                : entry.status === "skipped"
                  ? "bg-warning mt-1.5 size-2 shrink-0 rounded-full"
                  : "bg-success mt-1.5 size-2 shrink-0 rounded-full"
            }
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, " ")}
              {entry.status === "failed" ? <span className="text-destructive"> · failed</span> : null}
            </p>
            {entry.message ? (
              <p className="text-muted-foreground text-xs break-words">{entry.message}</p>
            ) : null}
            <p className="text-muted-foreground mt-0.5 text-xs">
              {entry.actor?.full_name ?? entry.actor?.email ?? "System"} · {formatLocalDateTime(entry.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
