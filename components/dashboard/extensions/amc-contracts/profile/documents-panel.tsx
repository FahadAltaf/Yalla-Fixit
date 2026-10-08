"use client";

import { useState } from "react";
import { Download, EllipsisVerticalIcon, FileText, Upload } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AMC_DOCUMENT_MAX_BYTES, DOCUMENT_CATEGORIES, documentExpiryState, type DocumentLevel } from "@/lib/amc/client-profile";
import { todayInDubai } from "@/lib/amc/contracts";
import { clientProfileService, type DocumentRecord } from "@/modules/amc-contracts/client-profile-service";

import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";
import { useDialog } from "./use-dialog";

const LEVEL_LABELS: Record<DocumentLevel, string> = {
  customer: "Client",
  property: "Property",
  contract: "Contract",
  proposal: "Proposal",
  enquiry: "Enquiry",
  visit: "Visit",
  call_out: "Call out",
};

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Documents of one record (BRD 5.9, DEV-381), or everything that rolls up to
 * a client (`customerId`). Uploading the same category and title again makes
 * a new version; earlier versions are kept and shown as superseded.
 */
export function DocumentsPanel({
  target,
  canUpload,
  title = "Documents",
}: {
  /** Upload and list for one record; or list a client's documents (upload goes to the client). */
  target: { level: DocumentLevel; entityId: string } | { customerId: string };
  canUpload: boolean;
  title?: string;
}) {
  const key = "customerId" in target ? `docs|c|${target.customerId}` : `docs|${target.level}|${target.entityId}`;
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.documents(target), key);
  const uploading = useDialog();
  const [showSuperseded, setShowSuperseded] = useState(false);
  const uploadTarget = "customerId" in target ? { level: "customer" as const, entityId: target.customerId } : target;
  const rollsUp = "customerId" in target;
  const today = todayInDubai();

  const download = async (doc: DocumentRecord) => {
    try {
      const { url } = await clientProfileService.documentUrl(doc.id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download");
    }
  };

  const docs = (data?.documents ?? []).filter((d) => showSuperseded || !d.superseded);
  const supersededCount = (data?.documents ?? []).filter((d) => d.superseded).length;
  const canAdd = canUpload && data?.migrated !== false;

  return (
    <SectionCard
      icon={<FileText />}
      title={title}
      description="Private files with a category, version, uploader and expiry. Uploading the same title again keeps the old version."
      bodyClassName="border-t"
      action={
        <div className="flex items-center gap-2">
          {supersededCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowSuperseded((v) => !v)}>
              {showSuperseded ? "Hide earlier versions" : `Show earlier versions (${supersededCount})`}
            </Button>
          ) : null}
          {canAdd ? (
            <Button size="sm" variant="outline" onClick={() => uploading.show(true)}>
              <Upload className="size-4" />
              Upload
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the documents" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : data?.migrated === false ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">The document store arrives with the Phase 2 database update (20261007120000).</p>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No documents yet"
          description="Trade licences, title deeds, access passes, signed scans and photos are kept here."
          action={canAdd ? { label: "Upload", onClick: () => uploading.show(true) } : undefined}
        />
      ) : (
        <ul className="divide-y">
          {docs.map((d) => {
            const expiry = documentExpiryState(d.expiresOn, today);
            return (
              <li key={d.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 ${d.superseded ? "opacity-60" : ""}`}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{d.title}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        v{d.version}
                        {d.superseded ? " (earlier)" : ""}
                      </span>
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {[d.category, rollsUp ? `For the ${LEVEL_LABELS[d.level].toLowerCase()}` : null, `${d.fileName} · ${sizeLabel(d.sizeBytes)}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>{formatContractDate(d.uploadedAt.slice(0, 10))}</div>
                  <div className="text-muted-foreground text-xs">{d.uploadedBy ?? "—"}</div>
                </div>
                {d.expiresOn ? (
                  <Badge
                    variant="secondary"
                    className={`border-0 font-medium ${expiry === "expired" ? "bg-danger/10 text-danger" : expiry === "expiring" ? "bg-warning/10 text-warning" : "bg-mist text-ink-soft"}`}
                  >
                    {expiry === "expired" ? "Expired " : "Expires "}
                    {formatContractDate(d.expiresOn)}
                  </Badge>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <EllipsisVerticalIcon className="size-4" />
                      <span className="sr-only">Actions for {d.title}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void download(d)}>
                      <Download className="size-4" />
                      Download
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
      <UploadDialog key={uploading.key} open={uploading.open} onOpenChange={uploading.onOpenChange} level={uploadTarget.level} entityId={uploadTarget.entityId} onUploaded={reload} />
    </SectionCard>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  level,
  entityId,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: DocumentLevel;
  entityId: string;
  onUploaded: () => void;
}) {
  const categories = DOCUMENT_CATEGORIES[level];
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(categories[0]);
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  /* A field check, so it stays on the form beside the file it is about. */
  const tooLarge = Boolean(file && file.size > AMC_DOCUMENT_MAX_BYTES);

  const submit = async () => {
    if (!file || tooLarge) return;
    setBusy(true);
    try {
      const { document } = await clientProfileService.uploadDocument({
        file,
        level,
        entityId,
        category,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        expiresOn: expiresOn || null,
        notes: notes.trim() || null,
      });
      toast.success(document.version > 1 ? `Uploaded as version ${document.version}.` : "Uploaded.");
      onUploaded();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>Stores the file privately, opened through a short-lived link. PDF, JPEG, PNG, WebP, Word or Excel, up to 20 MB.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="doc-file">File</Label>
            <Input
              id="doc-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              aria-invalid={tooLarge || undefined}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
            {tooLarge ? <p className="text-danger text-xs">The file is larger than 20 MB.</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="doc-expiry">Expires on (optional)</Label>
              <Input id="doc-expiry" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Trade licence 2026" />
            <p className="text-muted-foreground text-xs">The same category and title again becomes a new version.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-notes">Notes (optional)</Label>
            <Textarea id="doc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void submit()} pending={busy} pendingLabel="Uploading…" icon={<Upload className="size-4" />} disabled={!file || tooLarge}>
            Upload
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
