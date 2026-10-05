"use client";

import { useState } from "react";
import { Download, Eye, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import type { AmcDocumentType, AmcSubmission } from "@/components/dashboard/extensions/amc/amc-types";
import { useAmcActions } from "@/components/dashboard/extensions/amc/use-amc-actions";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { formatDateTime } from "./contract-status";

/**
 * The contract's documents: the proposal (the client's brochure with
 * their plan) and the contract, rebuilt from the signed proposal's saved
 * data and the wording captured when each was sent.
 *
 * There is no stored copy of the signed PDF: the portal keeps the signed
 * data, the signature and the wording snapshot, and renders the document
 * from them. A document never sent renders with today's settings.
 */
export function ContractDocuments({
  submissionId,
  proposalSentAt,
  contractSentAt,
}: {
  submissionId: string;
  proposalSentAt: string | null;
  contractSentAt: string | null;
}) {
  const [submission, setSubmission] = useState<AmcSubmission | null>(null);
  const actions = useAmcActions({ onChanged: () => undefined });

  const withSubmission = async (): Promise<AmcSubmission | null> => {
    if (submission) return submission;
    try {
      const loaded = await amcSubmissionsService.getSubmission(submissionId);
      setSubmission(loaded);
      return loaded;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the signed proposal.");
      return null;
    }
  };

  const view = async (type: AmcDocumentType) => {
    const s = await withSubmission();
    if (s) actions.view(s, type);
  };
  const download = async (type: AmcDocumentType) => {
    const s = await withSubmission();
    if (s) actions.download(s, type, "pdf");
  };

  const docs: Array<{ type: AmcDocumentType; label: string; sentAt: string | null }> = [
    { type: "proposal", label: "Proposal and brochure", sentAt: proposalSentAt },
    { type: "contract", label: "Contract", sentAt: contractSentAt },
  ];

  return (
    <SectionCard title="Documents" icon={<FileText />} bodyClassName="px-5 pb-5 space-y-3">
      {actions.dialogs}
      {docs.map((doc) => (
        <div key={doc.type} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">{doc.label}</div>
            <div className="text-muted-foreground text-xs">
              {doc.sentAt ? `Wording as sent ${formatDateTime(doc.sentAt)}` : "Not sent: renders with today's settings"}
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void view(doc.type)}
              disabled={actions.viewingKey === `${submissionId}:${doc.type}`}
            >
              <Eye className="size-4" />
              View
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void download(doc.type)}
              disabled={actions.downloadingId === submissionId}
            >
              <Download className="size-4" />
              PDF
            </Button>
          </div>
        </div>
      ))}
      <p className="text-muted-foreground text-xs">
        Rebuilt from the signed proposal&apos;s saved data and wording. A stored copy of the signed
        PDF is not kept.
      </p>
    </SectionCard>
  );
}
