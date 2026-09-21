"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CheckCircle2,
  ChevronLeft,
  Link as LinkIcon,
  Mail,
  ChevronRight,
  EllipsisVerticalIcon,
  EyeIcon,
  FileText,
  Loader2,
  PencilIcon,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IdentityCell } from "@/components/ui/entity-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/actions/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrencyAED } from "@/utils/format-currency";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { openAmcPdfFromSubmission } from "./amc-document-utils";
import {
  AMC_STATUS_LABELS,
  isAmcSubmissionEditable,
  type AmcDocumentType,
  type AmcSubmission,
  type AmcSubmissionStatus,
} from "./amc-types";

/* FR5.8 — nine statuses across four parties. Colour carries the same
   information as the label so the queue reads at a glance: amber is
   waiting on someone, red needs the team to act, green has landed. */
function amcStatusTone(status: AmcSubmissionStatus): string {
  switch (status) {
    case "signed":
    case "proposal_approved":
      return "bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400";
    case "awaiting_approval":
    case "proposal_sent":
    case "contract_sent":
      return "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400";
    case "sent_back":
    case "proposal_rejected":
      return "bg-destructive/10 text-destructive";
    case "approved":
      return "bg-sky-600/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-400";
    case "draft":
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface SubmissionsListProps {
  refreshKey: number;
  onEdit: (submissionId: string) => void;
  onCreateNew: () => void;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function SubmissionsList({
  refreshKey,
  onEdit,
  onCreateNew,
}: SubmissionsListProps) {
  const [submissions, setSubmissions] = useState<AmcSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [sendBackFor, setSendBackFor] = useState<AmcSubmission | null>(null);
  const [sendBackReason, setSendBackReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
      toast.error(
        getErrorMessage(error, "Failed to load submissions. Please try again."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions, refreshKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return submissions;
    return submissions.filter((sub) =>
      [sub.customer.customerName, sub.property.propertyAddress]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [submissions, search]);

  const total = visible.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = visible.slice(pageStart, pageStart + pageSize);

  // A narrowed result set should never leave you stranded on a page that no
  // longer exists.
  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  /*
    FR5.2 — approve, or send back with a reason. The list reloads rather
    than patching the row in place: a decision changes which rows the
    caller can see at all (FR3.2), so a local edit would leave the queue
    showing a row the next reload drops.
  */
  const handleDecision = async (
    submission: AmcSubmission,
    action: "approve" | "send_back",
    reason?: string,
  ) => {
    setDeciding(true);
    try {
      await amcSubmissionsService.decide(
        action === "approve"
          ? { action: "approve", id: submission.id }
          : { action: "send_back", id: submission.id, reason: reason ?? "" },
      );
      toast.success(
        action === "approve"
          ? "Approved. It can now be sent to the client."
          : "Sent back to the owner with your reason.",
      );
      setSendBackFor(null);
      setSendBackReason("");
      await loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(
        getErrorMessage(
          error,
          action === "approve"
            ? "Failed to approve this proposal."
            : "Failed to send this proposal back.",
        ),
      );
    } finally {
      setDeciding(false);
    }
  };

  /*
    FR5.4 / FR5.6 — send the document, or take the link to send over
    WhatsApp. Both mint a token and advance the status; only the delivery
    differs, so they are one call with a `deliver` flag rather than two
    code paths that could drift.
  */
  const handleSend = async (
    submission: AmcSubmission,
    document: "proposal" | "contract",
    deliver: "email" | "link",
  ) => {
    setSendingId(submission.id);
    try {
      const result = await amcSubmissionsService.send({
        id: submission.id,
        document,
        deliver,
      });

      if (deliver === "link") {
        await navigator.clipboard.writeText(result.link).catch(() => {
          /* Clipboard access can be refused; the link still has to reach
             the person, so it is shown rather than silently lost. */
          window.prompt("Copy this link and send it to the client:", result.link);
        });
        toast.success("Link copied. Paste it into WhatsApp to send it.");
      } else if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(
          document === "proposal"
            ? "Proposal emailed to the client."
            : "Contract emailed to the client.",
        );
      }
      await loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, "Failed to send this document."));
    } finally {
      setSendingId(null);
    }
  };

  const handleView = async (
    submission: AmcSubmission,
    documentType: AmcDocumentType,
  ) => {
    const toastId = `amc-view-pdf-${submission.id}-${documentType}`;
    const viewKey = `${submission.id}:${documentType}`;

    setViewingKey(viewKey);
    toast.loading(
      documentType === "proposal"
        ? "Opening proposal PDF..."
        : "Opening contract PDF...",
      { id: toastId },
    );

    try {
      await openAmcPdfFromSubmission(submission, documentType);
      toast.success(
        documentType === "proposal"
          ? "Proposal opened in a new tab."
          : "Contract opened in a new tab.",
        { id: toastId },
      );
    } catch (error) {
      console.error(error);
      toast.error(
        getErrorMessage(
          error,
          "Failed to generate the PDF. Please try again.",
        ),
        { id: toastId },
      );
    } finally {
      setViewingKey(null);
    }
  };

  // Everything below the toolbar swaps between skeleton / empty / error /
  // rows, but the toolbar and table header stay mounted throughout so search
  // and refresh remain usable while loading and nothing reflows.
  const body = () => {
    if (isLoading) {
      return Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </TableCell>
          <TableCell className="">
            <Skeleton className=" h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-sm" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-32" />
          </TableCell>
          <TableCell>
            <Skeleton className=" size-8 rounded-md" />
          </TableCell>
        </TableRow>
      ));
    }

    if (loadError) {
      return (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="p-0">
            <EmptyState
              className="border-0"
              icon={<ScrollText className="size-5" />}
              title="Could not load submissions"
              description="Something went wrong while fetching your AMC submissions."
              action={{ label: "Retry", onClick: () => void loadSubmissions() }}
            />
          </TableCell>
        </TableRow>
      );
    }

    if (pageRows.length === 0) {
      return (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="p-0">
            <EmptyState
              className="border-0"
              icon={<ScrollText className="size-5" />}
              title={search ? "No matching submissions" : "No AMC submissions yet"}
              description={
                search
                  ? `Nothing matches “${search}”. Try a different customer or address.`
                  : "Start a new proposal to create your first draft."
              }
              action={
                search
                  ? { label: "Clear search", onClick: () => setSearch(""), variant: "outline" }
                  : { label: "Create New", onClick: onCreateNew }
              }
            />
          </TableCell>
        </TableRow>
      );
    }

    return pageRows.map((submission) => {
      const isViewing = viewingKey?.startsWith(`${submission.id}:`);
      const customer = submission.customer.customerName || "Unnamed customer";

      return (
        <TableRow key={submission.id}>
          <TableCell>
            <IdentityCell
              title={customer}
              subtitle={submission.property.propertyAddress || "No address"}
              seed={submission.id}
            />
          </TableCell>
          {/* Currency right-aligns so the magnitudes line up down the column. */}
          <TableCell className=" text-sm tabular-nums">
            {formatCurrencyAED(Number(submission.final_price))}
          </TableCell>
          <TableCell>
            <div className="flex flex-col items-start gap-1">
              <Badge variant="secondary" className={`border-none ${amcStatusTone(submission.status)}`}>
                {AMC_STATUS_LABELS[submission.status] ?? submission.status}
              </Badge>
              {/* FR5.2 — the owner has to see WHY it came back, or the
                  send-back tells them nothing actionable. */}
              {submission.status === "sent_back" && submission.sent_back_reason && (
                <span className="text-muted-foreground max-w-[26ch] text-xs leading-snug">
                  {submission.sent_back_reason}
                </span>
              )}
            </div>
          </TableCell>
          <TableCell className="text-muted-foreground text-sm">
            {format(new Date(submission.updated_at), "dd MMM yyyy, HH:mm")}
          </TableCell>
          <TableCell className="">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${customer}`}
                  disabled={isViewing || sendingId === submission.id}
                >
                  {isViewing || sendingId === submission.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <EllipsisVerticalIcon className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max">
                {/* FR3.4 — locked once sent for review. Hidden rather
                    than shown-and-refused: opening a locked submission in
                    the wizard would let the team type into a form whose
                    every autosave the server rejects. */}
                {isAmcSubmissionEditable(submission.status) && (
                  <DropdownMenuItem onClick={() => onEdit(submission.id)}>
                    <PencilIcon className="size-4" />
                    Edit
                  </DropdownMenuItem>
                )}

                {/* FR5.4 — a proposal may only be sent once it has been
                    approved internally. FR5.6 — a contract only once the
                    client has approved the proposal. */}
                {submission.status === "approved" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => void handleSend(submission, "proposal", "email")}
                    >
                      <Mail className="size-4" />
                      Email proposal to client
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleSend(submission, "proposal", "link")}
                    >
                      <LinkIcon className="size-4" />
                      Copy proposal link
                    </DropdownMenuItem>
                  </>
                )}
                {submission.status === "proposal_approved" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => void handleSend(submission, "contract", "email")}
                    >
                      <Mail className="size-4" />
                      Email contract to client
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleSend(submission, "contract", "link")}
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
                      onClick={() => void handleDecision(submission, "approve")}
                    >
                      <CheckCircle2 className="size-4" />
                      Approve
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSendBackFor(submission)}>
                      <Undo2 className="size-4" />
                      Send back…
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => void handleView(submission, "proposal")}>
                  <FileText className="size-4" />
                  View Proposal
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleView(submission, "contract")}>
                  <EyeIcon className="size-4" />
                  View Contract
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      );
    });
  };

  const sendBackDialog = (
    <Dialog
      open={Boolean(sendBackFor)}
      onOpenChange={(open) => {
        if (open) return;
        setSendBackFor(null);
        setSendBackReason("");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send back for changes</DialogTitle>
          <DialogDescription>
            The owner sees this reason on their submission and can edit and
            resubmit. Nothing is sent to the client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="amc-send-back-reason">What needs changing?</Label>
          <Textarea
            id="amc-send-back-reason"
            rows={4}
            value={sendBackReason}
            onChange={(event) => setSendBackReason(event.target.value)}
            placeholder="e.g. The AC PPM frequency should be 4 visits, not 2."
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSendBackFor(null);
              setSendBackReason("");
            }}
            disabled={deciding}
          >
            Cancel
          </Button>
          {/* FR5.2 requires a reason, so the action stays disabled until
              there is one rather than failing on the server. */}
          <Button
            onClick={() =>
              sendBackFor &&
              void handleDecision(sendBackFor, "send_back", sendBackReason.trim())
            }
            disabled={deciding || sendBackReason.trim().length === 0}
          >
            {deciding ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-col gap-4">
      {sendBackDialog}
      {/* Toolbar: search left, page size / refresh / primary action right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search submissions"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="h-8 w-[110px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void loadSubmissions()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" className="h-8" onClick={onCreateNew}>
            <Plus className="size-4" />
            Create New
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer / Property</TableHead>
              <TableHead className="">Final Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{body()}</TableBody>
        </Table>

        {!isLoading && !loadError && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <p className="text-muted-foreground text-sm">
              Showing {pageStart + 1} to {Math.min(pageStart + pageSize, total)} of {total} submissions
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <span className="text-muted-foreground px-2 text-sm tabular-nums">
                Page {currentPage} of {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={currentPage === pageCount}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
