"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import {
  EllipsisVerticalIcon,
  EyeIcon,
  Loader2,
  PencilIcon,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
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

import {
  openAmcPdfFromSubmission,
  resolveViewDocumentType,
} from "./amc-document-utils";
import type { AmcSubmission } from "./amc-types";

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
  const [viewingSubmissionId, setViewingSubmissionId] = useState<string | null>(
    null,
  );

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

  const handleView = async (submission: AmcSubmission) => {
    const documentType = resolveViewDocumentType(submission);
    const toastId = `amc-view-pdf-${submission.id}`;

    setViewingSubmissionId(submission.id);
    toast.loading(
      documentType === "proposal"
        ? "Opening proposal PDF..."
        : "Opening contract PDF...",
      { id: toastId },
    );

    try {
      await openAmcPdfFromSubmission(submission);
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
      setViewingSubmissionId(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full max-w-sm" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <EmptyState
        title="Could not load submissions"
        description="Something went wrong while fetching your AMC submissions. Please try again."
        icon={<ScrollText />}
        action={{
          label: "Retry",
          onClick: () => void loadSubmissions(),
        }}
      />
    );
  }

  if (submissions.length === 0) {
    return (
      <EmptyState
        title="No AMC submissions yet"
        description="Start a new proposal to create your first draft."
        icon={<ScrollText />}
        action={{
          label: "Create New",
          onClick: onCreateNew,
        }}
      />
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer / Property</TableHead>
            <TableHead>Final Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((submission) => {
            const isViewing = viewingSubmissionId === submission.id;

            return (
              <TableRow key={submission.id}>
                <TableCell>
                  <div className="text-sm font-medium">
                    {submission.customer.customerName || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {submission.property.propertyAddress || "—"}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {formatCurrencyAED(Number(submission.final_price))}
                </TableCell>
                <TableCell>
                  <StatusBadge status={submission.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(submission.updated_at), "dd MMM yyyy, HH:mm")}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Open menu"
                        disabled={isViewing}
                      >
                        {isViewing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <EllipsisVerticalIcon className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-max">
                      <DropdownMenuItem onClick={() => onEdit(submission.id)}>
                        <PencilIcon className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void handleView(submission)}
                      >
                        <EyeIcon className="mr-2 h-4 w-4" />
                        View
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
