"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, FileText, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DataRow, SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { snaggingService, type SnaggingQuotationFsm } from "@/modules/snagging";

import { FsmEventList } from "./fsm-activity";
import { SubmitButton, formatLocalDateTime } from "./shared";

/**
 * This quotation in Zoho FSM (SNG-188, SNG-191), in the quotation's Activity
 * tab: the estimate it is, where it stands, why the last sync failed if it
 * did, a Retry, and a page of every FSM call made for it and its client.
 * The page is asked of the server when this tab opens and on each page
 * change; nothing is fetched up front.
 */
export function FsmQuotationCard({ quotationId, canEdit }: { quotationId: string; canEdit: boolean }) {
  const [state, setState] = useState<SnaggingQuotationFsm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  // The page the rows on screen answer; loading until it is the current one.
  const [shownPage, setShownPage] = useState<string | null>(null);
  const logLoading = shownPage !== `${page}:${pageSize}`;

  const load = useCallback(async () => {
    try {
      setState(await snaggingService.getQuotationFsm(quotationId, { page, pageSize }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the FSM sync");
    } finally {
      setShownPage(`${page}:${pageSize}`);
    }
  }, [quotationId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      const result = await snaggingService.syncQuotationFsm(quotationId);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The FSM sync failed");
    } finally {
      setSyncing(false);
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
          ? {
              label: "Needs attention",
              tone: "bg-destructive/10 text-destructive",
            }
          : quote?.fsm_estimate_id
            ? { label: "In FSM", tone: "bg-success/10 text-success" }
            : { label: "Not synced", tone: "bg-warning/10 text-warning" };

  const live = Boolean(state && state.enabled && state.ready && !error);

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Zoho FSM"
        icon={<CloudUpload />}
        description="This quotation as an estimate in Zoho FSM."
        action={badge ? <Badge className={`border-0 ${badge.tone}`}>{badge.label}</Badge> : null}
        bodyClassName="border-t"
      >
        {error ? (
          <p className="text-destructive p-5 text-sm">{error}</p>
        ) : !state ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-9 w-1/2" />
          </div>
        ) : !state.enabled ? (
          <p className="text-muted-foreground p-5 text-sm">
            Syncing with Zoho FSM is switched off. It starts once SNAGGING_FSM_SYNC is set to &quot;on&quot;.
          </p>
        ) : !state.ready ? (
          <p className="text-muted-foreground p-5 text-sm">
            The Zoho FSM sync needs its database migration applied first.
          </p>
        ) : (
          <>
            <DataRow
              icon={<FileText aria-hidden />}
              title={
                quote?.fsm_estimate_id ? `Estimate ${quote.fsm_estimate_number ?? quote.fsm_estimate_id}` : "Estimate"
              }
              subtitle={quote?.fsm_estimate_id ? (quote.fsm_status ?? "—") : "Not in FSM yet"}
              /*
              The sync runs by itself on every create, edit, send and
              decision, so a button is only offered when there is something
              to do: the last sync failed, or the estimate is not in FSM yet.
              Otherwise the row just says when it last went.
            */
              trailing={
                canEdit && (quote?.fsm_error || !quote?.fsm_estimate_id) ? (
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    onClick={() => void sync()}
                    pending={syncing}
                    pendingLabel="Syncing…"
                    icon={<RefreshCw className="size-4" />}
                  >
                    {quote?.fsm_error ? "Retry" : "Send to FSM"}
                  </SubmitButton>
                ) : quote?.fsm_synced_at ? (
                  <span className="text-muted-foreground text-xs">
                    Synced {formatLocalDateTime(quote.fsm_synced_at)}
                  </span>
                ) : null
              }
            />

            {quote?.fsm_error ? (
              <div className="bg-destructive/5 border-destructive/20 mx-5 mb-3 flex gap-2 rounded-md border p-3 text-sm">
                <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                <p className="break-words">{quote.fsm_error}</p>
              </div>
            ) : null}
          </>
        )}
      </SectionCard>

      {/* Every FSM call for the quotation and its client: a card of its own. */}
      {live && state ? (
        <SectionCard
          title="FSM activity"
          icon={<History />}
          description="Every call made to Zoho FSM for this quotation and its client, newest first."
          bodyClassName="border-t"
        >
          <FsmEventList
            log={state.log}
            total={state.logTotal ?? 0}
            page={page}
            pageSize={pageSize}
            loading={logLoading}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
