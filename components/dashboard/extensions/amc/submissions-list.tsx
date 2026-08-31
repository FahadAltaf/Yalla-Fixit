"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ChevronLeft,
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
import StatusBadge from "@/components/ui/status-badge";
import { formatCurrencyAED } from "@/utils/format-currency";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { openAmcPdfFromSubmission } from "./amc-document-utils";
import type { AmcDocumentType, AmcSubmission } from "./amc-types";

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadSubmissions = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await amcSubmissionsService.listSubmissions();
      setSubmissions(response.submissions);
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
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-sm" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-32" />
          </TableCell>
          <TableCell>
            <Skeleton className="ml-auto size-8 rounded-md" />
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
          <TableCell className="text-right text-sm tabular-nums">
            {formatCurrencyAED(Number(submission.final_price))}
          </TableCell>
          <TableCell>
            <StatusBadge status={submission.status} />
          </TableCell>
          <TableCell className="text-muted-foreground text-sm">
            {format(new Date(submission.updated_at), "dd MMM yyyy, HH:mm")}
          </TableCell>
          <TableCell className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for ${customer}`}
                  disabled={isViewing}
                >
                  {isViewing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <EllipsisVerticalIcon className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max">
                <DropdownMenuItem onClick={() => onEdit(submission.id)}>
                  <PencilIcon className="size-4" />
                  Edit
                </DropdownMenuItem>
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

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: search left, page size / refresh / primary action right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search customer or address..."
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
              <TableHead className="text-right">Final Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="w-[1%] text-right">Actions</TableHead>
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
