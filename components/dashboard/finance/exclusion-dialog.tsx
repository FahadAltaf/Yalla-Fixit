"use client";

import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EVIDENCE_ACCEPT, EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES, evidenceContentType, evidenceFileName } from "@/lib/finance/evidence";

/**
 * "Mark not to be invoiced" (BRD 5.1 Step 5; TC05) with its evidence
 * files, shared by Ready to invoice (a work order) and the earlier queue
 * items: the dialog, the upload through one-time URLs into the private
 * bucket, and the links that open a file for a minute.
 */

export function ExclusionDialog({
  open,
  busy,
  onClose,
  onSubmit,
  verifiedAtOnce = false,
}: {
  open: boolean;
  busy: boolean;
  /** Operations marks it: excluded at once, no verification (27 Oct). */
  verifiedAtOnce?: boolean;
  onClose: () => void;
  onSubmit: (input: { reason: string; notes: string | null; files: File[] }) => void;
}) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const addFiles = (picked: FileList | null) => {
    const next = [...files];
    for (const file of Array.from(picked ?? [])) {
      if (!evidenceContentType(file.name, file.type)) {
        toast.error(`${file.name}: PDF, image, email or Office files only`);
      } else if (file.size > EVIDENCE_MAX_BYTES) {
        toast.error(`${file.name} is over 10 MB`);
      } else if (next.length >= EVIDENCE_MAX_FILES) {
        toast.error(`Up to ${EVIDENCE_MAX_FILES} files`);
        break;
      } else if (!next.some((f) => f.name === file.name && f.size === file.size)) {
        next.push(file);
      }
    }
    setFiles(next);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Mark not to be invoiced</DialogTitle>
          <DialogDescription>
            For example an AMC PPM visit or an in-contract call-out already paid for.{" "}
            {verifiedAtOnce
              ? "It is excluded at once, and stays visible in Ready to invoice and the reports."
              : "It is excluded only after verification, and stays visible in Ready to invoice and the reports."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="exclusion-reason">Reason</Label>
            <Input id="exclusion-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exclusion-notes">Supporting detail</Label>
            <Textarea id="exclusion-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exclusion-files">Evidence</Label>
            <Input
              id="exclusion-files"
              type="file"
              multiple
              accept={EVIDENCE_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="text-muted-foreground text-xs">
              The AMC contract page, the client&apos;s email or similar. PDF, image, email or Office files, up to 10 MB
              each.
            </p>
            {files.length ? (
              <ul className="grid gap-1">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 text-sm">
                    <Paperclip className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">{fileSize(file.size)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={busy}
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles(files.filter((f) => f !== file))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!reason.trim()} onClick={() => onSubmit({ reason: reason.trim(), notes: notes.trim() || null, files })}>
            Send for verification
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type Sign = (input: { fileName: string; contentType: string; size: number }) => Promise<{ path: string; signedUrl: string; contentType: string }>;

/** Each file straight to the private bucket through a one-time URL; returns the stored paths. */
export async function uploadEvidenceFiles(files: File[], sign: Sign) {
  const paths: string[] = [];
  for (const file of files) {
    const signed = await sign({
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    });
    const res = await fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "content-type": signed.contentType },
      body: file,
    });
    if (!res.ok) throw new Error(`${file.name} did not upload. Nothing was sent; try again.`);
    paths.push(signed.path);
  }
  return paths;
}

export function EvidenceLinks({ urlOf, paths }: { urlOf: (path: string) => string; paths: string[] }) {
  if (!paths.length) return <p className="text-muted-foreground mt-1 text-xs">No files attached.</p>;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {paths.map((path) => (
        <li key={path}>
          <a
            href={urlOf(path)}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-muted hover:bg-muted/70 inline-flex max-w-64 items-center gap-1.5 rounded-md px-2 py-1 text-xs"
          >
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{evidenceFileName(path)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
