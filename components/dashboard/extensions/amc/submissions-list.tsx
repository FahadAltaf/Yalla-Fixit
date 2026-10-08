"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  Clock,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  EllipsisVerticalIcon,
  EyeIcon,
  FileText,
  Info,
  Loader2,
  PencilIcon,
  ScrollText,
  Undo2,
  UserRound,
} from "lucide-react";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { useDebounce } from "@/hooks/use-debounce";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { grandTotalOf } from "./amc-pricing";
import { canDecideProposal } from "@/lib/amc/workflow";

import { AMC_APPROVALS_CHANGED } from "./amc-approval-notice";
import { amcStatusTone } from "./amc-status";
import { useAmcActions } from "./use-amc-actions";
import { ProposalsToolbar } from "./proposals-toolbar";
import {
  AMC_STATUSES,
  AMC_STATUS_LABELS,
  isAmcSubmissionEditable,
  type AmcSubmission,
  type AmcSubmissionStatus,
} from "./amc-types";

type Scope = "all" | "mine";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

/**
 * Every AMC proposal the viewer can see (FR3.2): their own, and -- for an
 * approver -- everyone's past draft.
 *
 * Opening one goes to its own page (/extensions/amc/<id>); editing a draft
 * goes to the wizard (/extensions/amc/<id>/edit); New proposal starts one at
 * /extensions/amc/new. The filters live in the address (?status=,
 * ?scope=), so a filtered list can be reloaded or shared.
 */
export function SubmissionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /* The current page's rows only; the server does the paging. */
  const [submissions, setSubmissions] = useState<AmcSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  /* Why the last load failed; shown above the table, not inside it. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const statusParam = searchParams.get("status");
  const status: AmcSubmissionStatus | "all" = (AMC_STATUSES as readonly string[]).includes(
    statusParam ?? "",
  )
    ? (statusParam as AmcSubmissionStatus)
    : "all";
  const scopeParam = searchParams.get("scope");
  /* Approvers see everyone's submitted proposals as well as their own. */
  const scope: Scope = scopeParam === "mine" ? "mine" : "all";

  /* A filter is a change of address, so Back and a reload keep it. */
  const setFilter = useCallback(
    (key: "status" | "scope", value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === "all") next.delete(key);
      else next.set(key, value);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      setPage(0);
    },
    [pathname, router, searchParams],
  );

  /*
    A page at a time from the server, filtered and searched there too.

    The whole history used to arrive on every visit and be sliced into
    pages here, so the table downloaded every proposal to draw ten, and
    the search could only look through what had already arrived. The
    search is sent a moment after typing stops, not on every keystroke.
  */
  const debouncedSearch = useDebounce(search.trim(), 300);

  /* Only the latest request may fill the table: a slower reply for an
     earlier filter or page must not land last and show the wrong rows. */
  const ticket = useRef(0);
  const loadSubmissions = useCallback(async () => {
    const mine = ++ticket.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await amcSubmissionsService.listSubmissions({
        status,
        scope,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      });
      if (mine !== ticket.current) return;
      setSubmissions(response.submissions);
      setTotal(response.totalCount ?? 0);
      setStatusCounts(response.counts ?? {});
      /* FR3.2 — the server decides this from role_access; the list just
         reflects it, so approval rights are never inferred client-side. */
      setCanApprove(Boolean(response.canApprove));
      /*
        A page that has emptied under the reader -- the last proposal on
        it approved out of an "Awaiting approval" filter, say -- steps
        back to the last page that still has rows rather than showing an
        empty table with pages still listed below it.
      */
      const lastPage = Math.max(0, Math.ceil((response.totalCount ?? 0) / pageSize) - 1);
      if (page > lastPage) setPage(lastPage);
    } catch (error) {
      if (mine !== ticket.current) return;
      console.error(error);
      setSubmissions([]);
      setTotal(0);
      setLoadError(getErrorMessage(error, "Couldn't load proposals. Try again."));
    } finally {
      if (mine === ticket.current) setIsLoading(false);
    }
  }, [status, scope, debouncedSearch, page, pageSize]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  /* The header bell found a new request: show it without a manual refresh. */
  useEffect(() => {
    const reload = () => void loadSubmissions();
    window.addEventListener(AMC_APPROVALS_CHANGED, reload);
    return () => window.removeEventListener(AMC_APPROVALS_CHANGED, reload);
  }, [loadSubmissions]);

  const actions = useAmcActions({ onChanged: loadSubmissions });

  const filtered = status !== "all" || scope !== "all" || Boolean(search);
  const clearFilters = () => {
    setSearch("");
    router.replace(pathname, { scroll: false });
    setPage(0);
  };

  /*
    The house table: the same DataTable, toolbar, identity cell, dirham
    amounts and page numbers as every other list in the portal.
  */
  const columns: ColumnDef<AmcSubmission>[] = [
    {
      id: "customer",
      header: "Client / Property",
      cell: ({ row }) => (
        // The client is the way into the proposal's own page.
        <Link
          href={`/extensions/amc/${row.original.id}`}
          className="focus-visible:ring-ring block rounded-md hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
        >
          <IdentityCell
            title={row.original.customer.customerName || "Unnamed client"}
            subtitle={row.original.property.propertyAddress || "No address"}
            icon={UserRound}
          />
        </Link>
      ),
      enableSorting: false,
    },
    ...(canApprove
      ? ([
          {
            id: "owner",
            header: "Submitted by",
            cell: ({ row }) => (
              <span className="text-sm">
                {row.original.is_own === false
                  ? row.original.owner_name || "Someone else"
                  : "You"}
              </span>
            ),
            enableSorting: false,
          },
        ] satisfies ColumnDef<AmcSubmission>[])
      : []),
    {
      id: "final_price",
      /* The figure the proposal, the contract and the detail page all
         quote: the annual fee with VAT on it. The column showed the
         stored ex-VAT price under this heading, which read as a different
         and smaller number than the same proposal's own page. */
      header: "Grand total",
      cell: ({ row }) => (
        <Money
          value={grandTotalOf(Number(row.original.final_price))}
          className="text-sm font-medium"
        />
      ),
      enableSorting: false,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const submission = row.original;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge
              variant="secondary"
              className={`border-0 font-medium ${amcStatusTone(submission.status)}`}
            >
              {AMC_STATUS_LABELS[submission.status] ?? submission.status}
            </Badge>
            {/* FR5.2 — the owner has to see WHY it came back, or the
                send-back tells them nothing actionable. */}
            {submission.status === "sent_back" &&
            submission.sent_back_reason ? (
              <span className="text-muted-foreground max-w-[26ch] text-xs leading-snug">
                {submission.sent_back_reason}
              </span>
            ) : null}
            {/*
              What the CLIENT typed when they rejected it is not repeated
              here. It is their words, in their tone, next to their name on
              a list anyone in the office scrolls past; the proposal's own
              page carries it in full, which is where somebody acting on it
              is reading anyway.
            */}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      /*
        When it was raised, which is also the order the list is in -- a
        column showing one date while the rows are ordered by another
        reads as no order at all.
      */
      id: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <IconText icon={Clock} muted>
          {format(new Date(row.original.created_at), "dd MMM yyyy, HH:mm")}
        </IconText>
      ),
      enableSorting: false,
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => {
        const submission = row.original;
        const isViewing = actions.viewingKey?.startsWith(`${submission.id}:`);
        const sending = actions.sendingId === submission.id;
        const customer = submission.customer.customerName || "Unnamed client";
        const isOwn = submission.is_own !== false;
        const canEdit = isAmcSubmissionEditable(submission.status) && isOwn;
        // FR5.4 / FR5.6 — what may go to the client, and only from its owner.
        const canSendProposal =
          isOwn && (submission.status === "approved" || submission.status === "proposal_sent");
        const canSendContract =
          isOwn &&
          (submission.status === "proposal_approved" || submission.status === "contract_sent");
        const canDecide =
          submission.status === "awaiting_approval" &&
          canDecideProposal({ canApprove, isOwner: isOwn });
        return (
          /* The row opens the proposal; the menu is its own thing, so a
             click in here never counts as a click on the row. */
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Actions for ${customer}`}
                // Also while an approval or send-back is in flight, so a
                // second one can't be started behind it.
                disabled={isViewing || sending || actions.deciding}
              >
                {isViewing || sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <EllipsisVerticalIcon className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            {/* Grouped so ten items read as four short lists: open it,
                read its documents, send it, decide on it. */}
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                {/* Every proposal has its own page: the client,
                    services, prices and everything that has happened. */}
                <DropdownMenuItem asChild>
                  <Link href={`/extensions/amc/${submission.id}`}>
                    <Info className="size-4" />
                    View details
                  </Link>
                </DropdownMenuItem>
                {/* FR3.4 — locked once sent for review. Hidden rather
                    than shown-and-refused: opening a locked submission in
                    the wizard would let the team type into a form whose
                    every autosave the server rejects. */}
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/extensions/amc/${submission.id}/edit`}>
                      <PencilIcon className="size-4" />
                      Edit
                    </Link>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Documents
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => actions.view(submission, "proposal")}>
                  <FileText className="size-4" />
                  View proposal
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.view(submission, "contract")}>
                  <EyeIcon className="size-4" />
                  View contract
                </DropdownMenuItem>
              </DropdownMenuGroup>

              {/* Sending is the owner's, as it is on the server: an
                  approver decides whether it may go out, and the document
                  goes to the client in the owner's name. */}
              {canSendProposal || canSendContract ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                    Send to client
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {canSendProposal ? (
                      <>
                        <DropdownMenuItem
                          onClick={() => actions.requestSend(submission, "proposal", "email")}
                        >
                          <Mail className="size-4" />
                          {submission.status === "proposal_sent"
                            ? "Email proposal again"
                            : "Email proposal to client"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => actions.requestSend(submission, "proposal", "whatsapp")}
                        >
                          <MessageCircle className="size-4" />
                          Share on WhatsApp
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => actions.requestSend(submission, "proposal", "link")}
                        >
                          <LinkIcon className="size-4" />
                          Copy proposal link
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {canSendContract ? (
                      <>
                        <DropdownMenuItem
                          onClick={() => actions.requestSend(submission, "contract", "email")}
                        >
                          <Mail className="size-4" />
                          {submission.status === "contract_sent"
                            ? "Email contract again"
                            : "Email contract to client"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => actions.requestSend(submission, "contract", "link")}
                        >
                          <LinkIcon className="size-4" />
                          Copy contract link
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuGroup>
                </>
              ) : null}

              {/* FR5.2 — the approver's two decisions, on the queue rows
                  only. */}
              {canDecide ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                    Decision
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => actions.approve(submission)}>
                      <CheckCircle2 className="size-4" />
                      Approve
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.sendBack(submission)}>
                      <Undo2 className="size-4" />
                      Send back…
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const statusOptions = [
    { value: "all", label: "All statuses", count: statusCounts.all ?? 0 },
    ...AMC_STATUSES.map((value) => ({
      value,
      label: AMC_STATUS_LABELS[value],
      count: statusCounts[value] ?? 0,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      {actions.dialogs}

      {loadError ? (
        <ErrorState
          title="Could not load proposals"
          message={loadError}
          onRetry={() => void loadSubmissions()}
          retrying={isLoading}
        />
      ) : null}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={submissions}
          loading={isLoading}
          rowCount={total}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onGlobalFilterChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          /* The row opens the proposal, as a row does on Jobs and
             Quotations. The Actions menu stops the click itself, so the
             two do not fight over it. */
          handleRowClick={(row) => router.push(`/extensions/amc/${row.id}`)}
          toolbar={
            <ProposalsToolbar
              search={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              isLoading={isLoading}
              onRefresh={() => void loadSubmissions()}
              statusOptions={statusOptions}
              status={status}
              onStatusChange={(value) => setFilter("status", value)}
              /* Whose proposals: an approver sees everyone's. */
              showScope={canApprove}
              scope={scope}
              onScopeChange={(value) => setFilter("scope", value)}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
            />
          }
          emptyState={
            <EmptyState
              className="border-0"
              icon={<ScrollText className="size-5" />}
              title={
                loadError
                  ? "Proposals could not be loaded"
                  : filtered
                    ? "No matching proposals"
                    : "No proposals yet"
              }
              description={
                loadError
                  ? "Try again once the connection is back."
                  : filtered
                    ? search
                      ? `Nothing matches "${search}" with these filters. Try another client, number or address.`
                      : "No proposals match these filters."
                    : "Start a new proposal and it will show up here."
              }
              action={
                loadError
                  ? undefined
                  : filtered
                    ? { label: "Clear filters", onClick: clearFilters, variant: "outline" }
                    : { label: "New proposal", onClick: () => router.push("/extensions/amc/new") }
              }
            />
          }
        />
      </Card>
    </div>
  );
}
