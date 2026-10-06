"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { amcContractsService, type SignedArchiveRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { formatDateTime } from "./contract-status";

/**
 * The ARCHIVED SIGNED DOCUMENT: the file stored when the client signed,
 * never regenerated. Shown apart from the generated documents, which are
 * rebuilt on request and are not the signed artifact.
 */
export function SignedArchiveRow({ submissionId }: { submissionId: string }) {
  const [archive, setArchive] = useState<SignedArchiveRecord | null>(null);
  const [signed, setSigned] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await amcContractsService.signedDocument(submissionId);
      setArchive(data.archive);
      setSigned(data.signed);
    } catch {
      /* Not visible to this user, or the table is not there yet: show nothing. */
    } finally {
      setLoaded(true);
    }
  }, [submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async () => {
    setBusy(true);
    try {
      const data = await amcContractsService.signedDocument(submissionId, true);
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the signed contract.");
    } finally {
      setBusy(false);
    }
  };

  const archiveNow = async () => {
    setBusy(true);
    try {
      const data = await amcContractsService.archiveSignedDocument(submissionId);
      setArchive(data.archive);
      toast.success("Signed contract archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not archive the signed contract.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || !signed) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Archive className="text-muted-foreground size-4" />
          Signed contract
          <Badge variant="secondary" className="font-normal">
            Archived signed document
          </Badge>
        </div>
        {archive ? (
          <div className="text-muted-foreground mt-1 text-xs">
            {archive.archivedWhen === "at_signing"
              ? "Stored when the client signed."
              : `Archived after signing (${formatDateTime(archive.createdAt)}) from the signed proposal's saved data and wording.`}{" "}
            Signed by {archive.signedByName} (typed name), {formatDateTime(archive.signedAt)}.{" "}
            {archive.contentType === "application/pdf" ? "PDF" : "HTML"} · SHA-256 {archive.fileSha256.slice(0, 12)}…
          </div>
        ) : (
          <div className="text-muted-foreground mt-1 text-xs">
            No archived copy yet. Archiving stores the contract exactly as signed, from its saved wording, and marks it as archived after signing.
          </div>
        )}
      </div>
      {archive ? (
        <Button size="sm" variant="outline" onClick={() => void open()} disabled={busy}>
          <ExternalLink className="size-4" />
          Open
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void archiveNow()} disabled={busy}>
          {busy ? "Archiving…" : "Archive now"}
        </Button>
      )}
    </div>
  );
}
