"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { useConfirm } from "@/components/dashboard/shared/kaizen-states";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  amcSettingsService,
  amcSubmissionsService,
} from "@/modules/amc-submissions";
import type { AmcSettings } from "./amc-settings";

import {
  buildAmcPdfFromSubmission,
  savedSettingsFor,
} from "./amc-document-utils";
import { useAmcPdfViewer } from "./amc-pdf-viewer";
import { AMC_APPROVALS_CHANGED } from "./amc-approval-notice";
import { amcStatusTone } from "./amc-status";
import { SubmissionDetailsDialog } from "./submission-details-dialog";
import { AmcSendDialog, type AmcSendRequest } from "./amc-send-dialog";
import {
  AMC_STATUS_LABELS,
  isAmcSubmissionEditable,
  type AmcDocumentType,
  type AmcSubmission,
} from "./amc-types";

interface SubmissionsListProps {
  refreshKey: number;
  onEdit: (submissionId: string) => void;
  onCreateNew: () => void;
}

/* The PDF as base64, for the email attachment. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Couldn't read the PDF."));
    reader.readAsDataURL(blob);
  });
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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /* Email always asks first (check the address); Copy link asks only when
     a link already exists, since a new one stops the old one working. */
  const [sendRequest, setSendRequest] = useState<AmcSendRequest | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const viewer = useAmcPdfViewer();
  const [detailsFor, setDetailsFor] = useState<AmcSubmission | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  /* Approvers see everyone's submitted proposals as well as their own. */
  const [scope, setScope] = useState<"all" | "mine" | "waiting">("all");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reviewId = searchParams.get("review");
  /* "Show all" on the approval notice lands here filtered (?scope=waiting). */
  const scopeParam = searchParams.get("scope");
  useEffect(() => {
    if (scopeParam !== "waiting") return;
    setScope("waiting");
    setPage(0);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("scope");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [scopeParam, searchParams, router, pathname]);

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
        getErrorMessage(error, "Couldn't load submissions. Try again."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions, refreshKey]);

  /* The header bell found a new request: show it without a manual refresh. */
  useEffect(() => {
    const reload = () => void loadSubmissions();
    window.addEventListener(AMC_APPROVALS_CHANGED, reload);
    return () => window.removeEventListener(AMC_APPROVALS_CHANGED, reload);
  }, [loadSubmissions]);

  /* Opened from the bell (?review=<id>): show that proposal's details,
     then drop the id from the address so a reload does not reopen it. */
  useEffect(() => {
    if (!reviewId || isLoading) return;
    const match = submissions.find((sub) => sub.id === reviewId);
    if (match) setDetailsFor(match);
    else toast.info("That proposal is no longer waiting for your approval.");
    const next = new URLSearchParams(searchParams.toString());
    next.delete("review");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [reviewId, isLoading, submissions, searchParams, router, pathname]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((sub) => {
      if (scope === "mine" && sub.is_own === false) return false;
      if (scope === "waiting" && sub.status !== "awaiting_approval")
        return false;
      if (!q) return true;
      return [
        sub.customer.customerName,
        sub.property.propertyAddress,
        sub.owner_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [submissions, search, scope]);

  const total = visible.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A narrowed result set never leaves you stranded on a page that no
  // longer exists.
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageRows = visible.slice(pageStart, pageStart + pageSize);

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
    /* Send back already asks, in its own dialog with the reason. */
    if (
      action === "approve" &&
      !(await confirm({
        title: "Approve this proposal?",
        description: `${submission.customer.customerName || "This proposal"}${submission.customer.proposalNumber ? ` (${submission.customer.proposalNumber})` : ""} will be approved and can then be sent to the client. It can't be edited after this.`,
        confirmText: "Approve",
      }))
    ) {
      return;
    }
    setDeciding(true);
    try {
      await amcSubmissionsService.decide(
        action === "approve"
          ? { action: "approve", id: submission.id }
          : { action: "send_back", id: submission.id, reason: reason ?? "" },
      );
      toast.success(
        action === "approve"
          ? "Approved. You can now send it to the client."
          : "Sent back to the owner with your note.",
      );
      setSendBackFor(null);
      setSendBackReason("");
      setDetailsFor(null);
      window.dispatchEvent(new Event(AMC_APPROVALS_CHANGED));
      await loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(
        getErrorMessage(
          error,
          action === "approve"
            ? "Couldn't approve this proposal."
            : "Couldn't send this proposal back.",
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
  const requestSend = (
    submission: AmcSubmission,
    document: "proposal" | "contract",
    deliver: "email" | "link",
  ) => {
    setSendRequest({ submission, document, deliver });
  };

  const handleSend = async (
    submission: AmcSubmission,
    document: "proposal" | "contract",
    deliver: "email" | "link",
    to?: string,
  ) => {
    setSendingId(submission.id);
    const label = document === "proposal" ? "proposal" : "contract";
    /* One toast from start to finish: building the link or sending the
       email takes a moment, and a click with no feedback gets repeated. */
    const toastId = toast.loading(
      deliver === "link"
        ? `Creating the ${label} link…`
        : `Emailing the ${label} to the client…`,
    );
    try {
      /* Email carries the PDF, like the snagging quotation. It is built
         with the text it will be sent with (FR6.4). */
      let pdf: { pdf_base64: string; pdf_filename: string } | undefined;
      if (deliver === "email") {
        toast.loading(`Preparing the ${label} PDF…`, { id: toastId });
        const settings = savedSettingsFor(submission, document)
          ? undefined
          : (await amcSettingsService.getSettings().catch(() => null))
              ?.settings;
        const built = await buildAmcPdfFromSubmission(
          submission,
          document,
          settings,
        );
        pdf = {
          pdf_base64: await blobToBase64(built.blob),
          pdf_filename: built.filename,
        };
        toast.loading(`Emailing the ${label} to the client…`, {
          id: toastId,
        });
      }
      const result = await amcSubmissionsService.send({
        id: submission.id,
        document,
        deliver,
        to,
        ...pdf,
      });
      setSendRequest(null);

      if (deliver === "link") {
        await navigator.clipboard.writeText(result.link).catch(() => {
          /* Clipboard access can be refused; the link still has to reach
             the person, so it is shown rather than silently lost. */
          window.prompt(
            "Copy this link and send it to the client:",
            result.link,
          );
        });
        toast.success(
          "Link copied. Paste it into WhatsApp or an email to send it.",
          { id: toastId },
        );
      } else if (result.warning) {
        toast.warning(result.warning, { id: toastId });
      } else {
        toast.success(
          document === "proposal"
            ? "Proposal emailed to the client."
            : "Contract emailed to the client.",
          { id: toastId },
        );
      }
      await loadSubmissions();
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, "Couldn't send this document."), {
        id: toastId,
      });
    } finally {
      setSendingId(null);
    }
  };

  /* Download a proposal or contract as PDF or Word, with a toast while it
     builds (a contract can take a few seconds). */
  const handleDownload = async (
    submission: AmcSubmission,
    documentType: AmcDocumentType,
    fileFormat: "pdf" | "docx",
  ) => {
    const label = documentType === "proposal" ? "proposal" : "contract";
    setDownloadingId(submission.id);
    const toastId = toast.loading(
      `Preparing the ${label} (${fileFormat === "pdf" ? "PDF" : "Word"})…`,
    );
    try {
      const settings = savedSettingsFor(submission, documentType)
        ? undefined
        : (await amcSettingsService.getSettings().catch(() => null))?.settings;
      const { blob, filename } = await buildAmcPdfFromSubmission(
        submission,
        documentType,
        settings,
        fileFormat,
      );
      saveAs(blob, filename);
      toast.success(`Downloaded ${filename}`, { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, `Couldn't download the ${label}.`), {
        id: toastId,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  /*
    View a submission's proposal or contract in the in-page viewer (see
    amc-pdf-viewer.tsx). The title names the proposal and the customer, so
    an approver working through the queue always knows which one is open.
  */
  const handleView = async (
    submission: AmcSubmission,
    documentType: AmcDocumentType,
  ) => {
    const viewKey = `${submission.id}:${documentType}`;
    const label = documentType === "proposal" ? "Proposal" : "Contract";
    const who = submission.customer.customerName || "Customer";
    const number = submission.customer.proposalNumber;

    setViewingKey(viewKey);
    try {
      /* A document not sent yet renders with the current settings; a sent
         one uses the text it was sent with (FR6.4). Loaded on demand,
         since most views are of sent documents that do not need it. */
      const liveSettings = async (): Promise<AmcSettings | undefined> =>
        savedSettingsFor(submission, documentType)
          ? undefined
          : (await amcSettingsService.getSettings().catch(() => null))
              ?.settings;

      await viewer.open(
        [label, number, who].filter(Boolean).join(" · "),
        async () =>
          buildAmcPdfFromSubmission(
            submission,
            documentType,
            await liveSettings(),
          ),
        {
          buildWord: async () =>
            buildAmcPdfFromSubmission(
              submission,
              documentType,
              await liveSettings(),
              "docx",
            ),
        },
      );
    } finally {
      setViewingKey(null);
    }
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
        <IdentityCell
          title={row.original.customer.customerName || "Unnamed customer"}
          subtitle={row.original.property.propertyAddress || "No address"}
          icon={UserRound}
        />
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
        const isViewing = viewingKey?.startsWith(`${submission.id}:`);
        const customer = submission.customer.customerName || "Unnamed customer";
        return (
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
            <DropdownMenuContent align="end">
              {/* FR3.4 — locked once sent for review. Hidden rather
                  than shown-and-refused: opening a locked submission in
                  the wizard would let the team type into a form whose
                  every autosave the server rejects. */}
              {isAmcSubmissionEditable(submission.status) &&
              submission.is_own !== false ? (
                <DropdownMenuItem onClick={() => onEdit(submission.id)}>
                  <PencilIcon className="size-4" />
                  Edit
                </DropdownMenuItem>
              ) : (
                /* Locked submissions still need to be readable: the
                   customer, services, prices and what has happened. */
                <DropdownMenuItem onClick={() => setDetailsFor(submission)}>
                  <Info className="size-4" />
                  View details
                </DropdownMenuItem>
              )}

              {/* FR5.4 — a proposal may only be sent once it has been
                  approved internally. FR5.6 — a contract only once the
                  client has approved the proposal. */}
              {(submission.status === "approved" ||
                submission.status === "proposal_sent") && (
                <>
                  <DropdownMenuItem
                    onClick={() => requestSend(submission, "proposal", "email")}
                  >
                    <Mail className="size-4" />
                    {submission.status === "proposal_sent"
                      ? "Email proposal again"
                      : "Email proposal to client"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => requestSend(submission, "proposal", "link")}
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
                    onClick={() => requestSend(submission, "contract", "email")}
                  >
                    <Mail className="size-4" />
                    {submission.status === "contract_sent"
                      ? "Email contract again"
                      : "Email contract to client"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => requestSend(submission, "contract", "link")}
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
              <DropdownMenuItem
                onClick={() => void handleView(submission, "proposal")}
              >
                <FileText className="size-4" />
                View proposal
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleView(submission, "contract")}
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
            The owner sees your note on their submission, makes the changes and
            resubmits. Nothing goes to the client.
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
              void handleDecision(
                sendBackFor,
                "send_back",
                sendBackReason.trim(),
              )
            }
            disabled={deciding || sendBackReason.trim().length === 0}
          >
            {deciding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Undo2 className="size-4" />
            )}
            Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-col gap-4">
      {sendBackDialog}
      {confirmDialog}
      <AmcSendDialog
        key={
          sendRequest
            ? `${sendRequest.submission.id}:${sendRequest.document}:${sendRequest.deliver}`
            : "closed"
        }
        request={sendRequest}
        pending={
          Boolean(sendRequest) && sendingId === sendRequest?.submission.id
        }
        onCancel={() => setSendRequest(null)}
        onConfirm={(request, to) =>
          void handleSend(
            request.submission,
            request.document,
            request.deliver,
            to,
          )
        }
      />
      {viewer.viewer}
      <SubmissionDetailsDialog
        submission={detailsFor}
        onOpenChange={(open) => !open && setDetailsFor(null)}
        onView={(submission, documentType) => {
          setDetailsFor(null);
          void handleView(submission, documentType);
        }}
        onEdit={(id) => {
          setDetailsFor(null);
          onEdit(id);
        }}
        canApprove={canApprove}
        deciding={deciding}
        onApprove={(submission) => void handleDecision(submission, "approve")}
        onSendBack={(submission) => setSendBackFor(submission)}
        onDownload={(submission, documentType, fileFormat) =>
          void handleDownload(submission, documentType, fileFormat)
        }
        downloading={downloadingId === detailsFor?.id}
        sending={sendingId === detailsFor?.id}
        onSend={(submission, document, deliver) =>
          requestSend(submission, document, deliver)
        }
      />
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
                  canApprove ? (
                    <Select
                      value={scope}
                      onValueChange={(value) => {
                        setScope(value as typeof scope);
                        setPage(0);
                      }}
                    >
                      <SelectTrigger
                        className="w-[200px]"
                        aria-label="Show submissions"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All submissions</SelectItem>
                        <SelectItem value="waiting">
                          Waiting for approval
                        </SelectItem>
                        <SelectItem value="mine">Mine only</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null
                }
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
                primaryAction={
                  <Button onClick={onCreateNew}>
                    <Plus className="size-4" />
                    Create New
                  </Button>
                }
              />
            }
            emptyState={
              <EmptyState
                className="border-0"
                icon={<ScrollText className="size-5" />}
                title={
                  search ? "No matching submissions" : "No AMC submissions yet"
                }
                description={
                  search
                    ? `Nothing matches "${search}". Try another customer name or address.`
                    : "Start a new proposal and it will show up here."
                }
                action={
                  search
                    ? {
                        label: "Clear search",
                        onClick: () => setSearch(""),
                        variant: "outline",
                      }
                    : { label: "Create New", onClick: onCreateNew }
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
