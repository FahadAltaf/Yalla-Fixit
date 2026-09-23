"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  Clock,
  Link as LinkIcon,
  Mail,
  EllipsisVerticalIcon,
  EyeIcon,
  FileText,
  Info,
  Loader2,
  PencilIcon,
  Plus,
  ScrollText,
  Undo2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { RecordsToolbar } from "@/components/data-table/toolbars/records-toolbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { AMC_APPROVALS_CHANGED } from "./amc-approval-notice";
import { amcStatusTone } from "./amc-status";
import { useAmcActions } from "./use-amc-actions";
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
 * goes to the wizard (/extensions/amc/<id>/edit); Create New starts one at
 * /extensions/amc/new. The filters live in the address (?status=,
 * ?scope=), so a filtered list can be reloaded or shared.
 */
export function SubmissionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [submissions, setSubmissions] = useState<AmcSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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

  const loadSubmissions = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await amcSubmissionsService.listSubmissions();
      setSubmissions(response.submissions);
      /* FR3.2 — the server decides this from role_access; the list just
         reflects it, so approval rights are never inferred client-side. */
      setCanApprove(Boolean(response.canApprove));
    } catch (error) {
      console.error(error);
      setSubmissions([]);
      setLoadError(true);
      toast.error(getErrorMessage(error, "Couldn't load submissions. Try again."));
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  /* How many proposals sit in each status, for the filter's counts. */
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sub of submissions) counts.set(sub.status, (counts.get(sub.status) ?? 0) + 1);
    return counts;
  }, [submissions]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((sub) => {
      if (scope === "mine" && sub.is_own === false) return false;
      if (status !== "all" && sub.status !== status) return false;
      if (!q) return true;
      return [
        sub.customer.customerName,
        sub.customer.proposalNumber,
        sub.property.propertyAddress,
        sub.owner_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [submissions, search, scope, status]);

  const total = visible.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A narrowed result set never leaves you stranded on a page that no
  // longer exists.
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageRows = visible.slice(pageStart, pageStart + pageSize);

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
      header: "Customer / Property",
      cell: ({ row }) => (
        // The customer is the way into the proposal's own page.
        <Link
          href={`/extensions/amc/${row.original.id}`}
          className="focus-visible:ring-ring block rounded-md hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
        >
          <IdentityCell
            title={row.original.customer.customerName || "Unnamed customer"}
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
      header: "Final price",
      cell: ({ row }) => (
        <Money
          value={Number(row.original.final_price)}
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
              className={`border-none ${amcStatusTone(submission.status)}`}
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
            {/* The client asked for changes: the owner edits and resubmits. */}
            {submission.status === "proposal_rejected" &&
            submission.client_rejected_reason ? (
              <span className="text-muted-foreground max-w-[26ch] text-xs leading-snug">
                {submission.client_rejected_reason}
              </span>
            ) : null}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "updated_at",
      header: "Last updated",
      cell: ({ row }) => (
        <IconText icon={Clock} muted>
          {format(new Date(row.original.updated_at), "dd MMM yyyy, HH:mm")}
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
        const customer = submission.customer.customerName || "Unnamed customer";
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Actions for ${customer}`}
                disabled={isViewing || sending}
              >
                {isViewing || sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <EllipsisVerticalIcon className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* FR3.4 — locked once sent for review. Hidden rather
                  than shown-and-refused: opening a locked submission in
                  the wizard would let the team type into a form whose
                  every autosave the server rejects. */}
              {/* Every proposal has its own page: the customer,
                  services, prices and everything that has happened. */}
              <DropdownMenuItem asChild>
                <Link href={`/extensions/amc/${submission.id}`}>
                  <Info className="size-4" />
                  View details
                </Link>
              </DropdownMenuItem>
              {isAmcSubmissionEditable(submission.status) &&
              submission.is_own !== false ? (
                <DropdownMenuItem asChild>
                  <Link href={`/extensions/amc/${submission.id}/edit`}>
                    <PencilIcon className="size-4" />
                    Edit
                  </Link>
                </DropdownMenuItem>
              ) : null}

              {/* FR5.4 — a proposal may only be sent once it has been
                  approved internally. FR5.6 — a contract only once the
                  client has approved the proposal. */}
              {(submission.status === "approved" ||
                submission.status === "proposal_sent") && (
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
                    onClick={() => actions.requestSend(submission, "proposal", "link")}
                  >
                    <LinkIcon className="size-4" />
                    Copy proposal link
                  </DropdownMenuItem>
                </>
              )}
              {(submission.status === "proposal_approved" ||
                submission.status === "contract_sent") && (
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
              )}

              {/* FR5.2 — the approver's two decisions, on the queue rows
                  only. */}
              {canApprove && submission.status === "awaiting_approval" && (
                <>
                  <DropdownMenuItem
                    onClick={() => actions.approve(submission)}
                  >
                    <CheckCircle2 className="size-4" />
                    Approve
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => actions.sendBack(submission)}>
                    <Undo2 className="size-4" />
                    Send back…
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem
                onClick={() => actions.view(submission, "proposal")}
              >
                <FileText className="size-4" />
                View proposal
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => actions.view(submission, "contract")}
              >
                <EyeIcon className="size-4" />
                View contract
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {actions.dialogs}
      <Card className="py-0">
        {loadError ? (
          <EmptyState
            className="border-0"
            icon={<ScrollText className="size-5" />}
            title="Could not load submissions"
            description="Something went wrong while loading your AMC submissions."
            action={{ label: "Retry", onClick: () => void loadSubmissions() }}
          />
        ) : (
          <DataTable
            columns={columns}
            data={pageRows}
            loading={isLoading}
            rowCount={total}
            pageSize={pageSize}
            currentPage={currentPage}
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
            toolbar={
              <RecordsToolbar
                fetchRecords={() => void loadSubmissions()}
                globalFilter={search}
                onGlobalFilterChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                isSearchLoading={isLoading}
                filters={
                  <>
                    {/* Whose proposals: an approver sees everyone's. */}
                    {canApprove ? (
                      <Select value={scope} onValueChange={(value) => setFilter("scope", value)}>
                        <SelectTrigger className="w-[200px]" aria-label="Show submissions">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All submissions</SelectItem>
                          <SelectItem value="mine">Mine only</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : null}
                    {/* Where they stand, with how many are in each. */}
                    <Select value={status} onValueChange={(value) => setFilter("status", value)}>
                      <SelectTrigger className="w-[200px]" aria-label="Filter by status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses ({submissions.length})</SelectItem>
                        {AMC_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {AMC_STATUS_LABELS[value]} ({statusCounts.get(value) ?? 0})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                }
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
                primaryAction={
                  <Button asChild>
                    <Link href="/extensions/amc/new">
                      <Plus className="size-4" />
                      Create New
                    </Link>
                  </Button>
                }
              />
            }
            emptyState={
              <EmptyState
                className="border-0"
                icon={<ScrollText className="size-5" />}
                title={filtered ? "No matching submissions" : "No AMC submissions yet"}
                description={
                  filtered
                    ? search
                      ? `Nothing matches "${search}" with these filters. Try another customer, number or address.`
                      : "No proposals match these filters."
                    : "Start a new proposal and it will show up here."
                }
                action={
                  filtered
                    ? { label: "Clear filters", onClick: clearFilters, variant: "outline" }
                    : { label: "Create New", onClick: () => router.push("/extensions/amc/new") }
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
