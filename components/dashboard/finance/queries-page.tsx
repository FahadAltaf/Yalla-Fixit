"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, CircleHelp, ExternalLink, Info, MessageSquareReply, RefreshCwIcon, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { DataRow, ListPager, PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, StatGridSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { refreshAll, useSection } from "@/components/dashboard/snagging/overview/use-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FinanceRequest, FinanceRequestList, FinanceRequestStatus } from "@/lib/server/finance/work-orders";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

import { EvidenceLinks } from "./exclusion-dialog";
import { daysSince } from "./shared";

const STATUS: Record<FinanceRequestStatus, { label: string; className: string }> = {
  waiting: { label: "Waiting", className: "bg-warning/10 text-warning" },
  answered: { label: "Answered", className: "bg-success/10 text-success" },
  verified: { label: "Verified: excluded", className: "bg-success/10 text-success" },
  rejected: { label: "Rejected", className: "bg-mist text-ink-soft" },
};

/**
 * The Queries page (26 Oct, change 9; 27 Oct): every query Finance has
 * raised and every request to mark a work order not invoiceable, kept once
 * answered or decided. Waiting or done, switched at the top; a card each,
 * paged by the server. A coordinator answers a query here; whoever
 * may verify decides a request. From the portal's records only: no FSM call.
 */

type Requests = FinanceRequestList & { canAnswer: boolean; canVerify: boolean };
type Shown = "waiting" | "done" | "all";
type Kind = "all" | "query" | "exclusion";

export function FinanceQueriesPage() {
  /* Filters and page in the page's own state: the list re-reads at once. */
  const [shown, setShown] = useState<Shown>("waiting");
  const [kind, setKind] = useState<Kind>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const url = `/api/finance/queries?status=${shown}&kind=${kind}&page=${page}&pageSize=${pageSize}`;
  const { data, loading, error, reload } = useSection<Requests>(url, { staleMs: 60_000 });

  const [answering, setAnswering] = useState<FinanceRequest | null>(null);
  const [answer, setAnswer] = useState("");
  const [deciding, setDeciding] = useState<{ request: FinanceRequest; decision: "verified" | "rejected" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const counts = data?.counts;
  const waitingTotal = counts ? counts.waitingQueries + counts.waitingExclusions : 0;
  const oldest = counts?.oldestWaitingAt ? daysSince(counts.oldestWaitingAt) : null;

  const openAnswer = (row: FinanceRequest) => {
    setAnswer("");
    setProblem(null);
    setAnswering(row);
  };
  const openDecision = (row: FinanceRequest, decision: "verified" | "rejected") => {
    setDecisionNote("");
    setProblem(null);
    setDeciding({ request: row, decision });
  };
  const rows = data?.rows ?? [];

  const send = async () => {
    if (!answering) return;
    setBusy(true);
    setProblem(null);
    try {
      await financeService.workOrderAction(answering.workOrderId, { action: "answer_query", expectedStatus: "query_raised", note: answer.trim() });
      toast.success("Answer sent to Finance");
      setAnswering(null);
      refreshAll();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The answer was not sent");
    } finally {
      setBusy(false);
    }
  };

  const decide = async () => {
    if (!deciding?.request.exclusionId) return;
    setBusy(true);
    setProblem(null);
    try {
      await financeService.decideWorkOrderExclusion(deciding.request.exclusionId, { decision: deciding.decision, note: decisionNote.trim() || null });
      toast.success(deciding.decision === "verified" ? "Verified: the work order is excluded from invoicing" : "Rejected: the work order stays as it was");
      setDeciding(null);
      refreshAll();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was decided");
    } finally {
      setBusy(false);
    }
  };

  const show = (next: Shown) => {
    setShown(next);
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Finance"
        title="Queries"
        description="Queries Finance has raised on work orders and requests to mark work orders not invoiceable: the ones waiting on an answer or a decision, and the ones done. Act here, or open the work order for its lines, invoices and history."
      />

      {data && !data.ledgerReady ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Queries are off</AlertTitle>
          <AlertDescription>Apply migration 20261024100000 to raise and answer queries on work orders.</AlertDescription>
        </Alert>
      ) : null}

      {counts ? (
        <StatCardGrid columns={4}>
          <StatCard
            label="Open queries"
            value={counts.waitingQueries}
            headline={counts.waitingQueries ? "Waiting on an answer" : "Nothing waiting"}
            tone={counts.waitingQueries ? "progress" : "good"}
          />
          <StatCard
            label="Not invoiceable"
            value={counts.waitingExclusions}
            headline={counts.waitingExclusions ? "Waiting to be verified" : "Nothing waiting"}
            tone={counts.waitingExclusions ? "progress" : "good"}
          />
          <StatCard
            label="Oldest waiting"
            value={oldest === null ? "—" : `${oldest} ${oldest === 1 ? "day" : "days"}`}
            headline={counts.overWeek ? `${counts.overWeek} waiting 7 days or more` : "None over a week"}
            tone={counts.overWeek ? "progress" : "neutral"}
          />
          <StatCard label="Done" value={counts.done} headline="Answered, verified or rejected" />
        </StatCardGrid>
      ) : error ? null : (
        <StatGridSkeleton count={4} columns={4} />
      )}

      {error && !data ? <ErrorState title="Could not load the queries" message={error} onRetry={reload} retrying={loading} /> : null}

      <SectionCard
        icon={<CircleHelp />}
        title={shown === "waiting" ? "Waiting on you" : shown === "done" ? "Done" : "All queries and requests"}
        description={shown === "done" ? "Answered, verified or rejected. Newest first." : "Oldest waiting first."}
        bodyClassName="border-t"
        action={
          <Button variant="outline" size="sm" onClick={() => refreshAll()} disabled={loading}>
            <RefreshCwIcon className="size-4" />
            Refresh
          </Button>
        }
      >
        {/* Not done yet, or done: answered, verified or rejected; and which kind. */}
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <PillTabs<Shown>
            value={shown}
            onChange={show}
            tabs={[
              { value: "waiting", label: "Waiting", count: counts ? waitingTotal : undefined },
              { value: "done", label: "Done", count: counts?.done },
              { value: "all", label: "All" },
            ]}
          />
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as Kind);
              setPage(0);
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="query">Queries</SelectItem>
              <SelectItem value="exclusion">Not invoiceable</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!data || loading ? (
          <ListSkeleton rows={Math.min(pageSize, 5)} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CircleHelp className="size-6" />}
            title={shown === "waiting" ? "Nothing waiting" : shown === "done" ? "Nothing done yet" : "No queries yet"}
            description={
              shown === "waiting"
                ? "Queries Finance raises and requests to mark a work order not invoiceable show here until they are answered or decided."
                : "Answered queries and verified or rejected requests stay here, newest first."
            }
          />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const waiting = r.status === "waiting";
              const status = STATUS[r.status];
              return (
                <li key={r.id}>
                  <DataRow
                    icon={r.kind === "query" ? <CircleHelp aria-hidden /> : <Ban aria-hidden />}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {r.quotationNumber ? `Quotation ${r.quotationNumber} · ${r.number ?? r.workOrderId}` : (r.number ?? r.workOrderId)}
                        <Badge variant="secondary" className={cn("border-0 font-medium", r.kind === "query" ? "bg-brand-50 text-brand" : "bg-mist text-ink-soft")}>
                          {r.kind === "query" ? "Query" : "Not invoiceable"}
                        </Badge>
                        <Badge variant="secondary" className={cn("border-0 font-medium", status.className)}>
                          {status.label}
                        </Badge>
                      </span>
                    }
                    subtitle={
                      <>
                        <span className="text-foreground/90">
                          {r.kind === "query" ? `"${r.text ?? "No question recorded"}"` : r.text}
                          {r.notes ? ` (${r.notes})` : ""}
                        </span>
                        {" · "}
                        {[r.clientName, r.askedBy ? `asked by ${r.askedBy}` : null, timeAgo(r.askedAt)].filter(Boolean).join(" · ")}
                        {!waiting ? (
                          <span className="mt-1 block">
                            <span className="text-foreground/90">
                              {r.kind === "query" ? "Answer: " : r.status === "verified" ? "Verified: " : "Rejected: "}
                              {r.response ? (r.kind === "query" ? `"${r.response}"` : r.response) : "no note"}
                            </span>
                            {" · "}
                            {[r.respondedBy, r.respondedAt ? timeAgo(r.respondedAt) : null].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                        {r.kind === "exclusion" && r.evidence.length ? (
                          <EvidenceLinks urlOf={(path) => financeService.workOrderEvidenceUrl(r.workOrderId, path)} paths={r.evidence} />
                        ) : null}
                      </>
                    }
                    trailing={
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {waiting && r.kind === "query" && data.canAnswer ? (
                          <Button size="sm" onClick={() => openAnswer(r)}>
                            <MessageSquareReply className="size-4" />
                            Answer
                          </Button>
                        ) : null}
                        {waiting && r.kind === "exclusion" && data.canVerify ? (
                          <>
                            <Button size="sm" onClick={() => openDecision(r, "verified")}>
                              <ShieldCheck className="size-4" />
                              Verify
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openDecision(r, "rejected")}>
                              <XCircle className="size-4" />
                              Reject
                            </Button>
                          </>
                        ) : null}
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/finance/queue/${r.workOrderId}${r.kind === "query" ? "?as=operations" : ""}`}>
                            <ExternalLink className="size-4" />
                            Open
                          </Link>
                        </Button>
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
        {/* Paged by the server: this page's cards come from it, with the total. */}
        <ListPager
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          noun="entries"
          className="border-t"
        />
      </SectionCard>

      <Dialog open={answering !== null} onOpenChange={(open) => !open && !busy && setAnswering(null)}>
        <ActionDialogContent busy={busy} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Answer Finance&apos;s query</DialogTitle>
            <DialogDescription>{answering?.text ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="query-answer">Answer</Label>
            <Textarea id="query-answer" rows={4} maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </div>
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnswering(null)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton pending={busy} disabled={!answer.trim()} onClick={() => void send()}>
              Send answer
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>

      <Dialog open={deciding !== null} onOpenChange={(open) => !open && !busy && setDeciding(null)}>
        <ActionDialogContent busy={busy} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deciding?.decision === "verified" ? "Verify: not to be invoiced" : "Reject the request"}</DialogTitle>
            <DialogDescription>
              {deciding?.decision === "verified"
                ? `${deciding.request.number ?? "The work order"} is marked Excluded and is never invoiced.`
                : `${deciding?.request.number ?? "The work order"} stays where it was, with your note.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="exclusion-note">{deciding?.decision === "rejected" ? "Why it is rejected" : "Note (optional)"}</Label>
            <Textarea id="exclusion-note" rows={3} maxLength={2000} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
          </div>
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton pending={busy} disabled={deciding?.decision === "rejected" && !decisionNote.trim()} onClick={() => void decide()}>
              {deciding?.decision === "verified" ? "Verify" : "Reject"}
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </div>
  );
}
