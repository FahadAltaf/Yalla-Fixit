"use client";

import { useRef, useState } from "react";
import { Download, FileText, MoreHorizontal, Upload } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { AMC_DOCUMENT_MAX_BYTES, DOCUMENT_CATEGORIES, documentExpiryState, type DocumentLevel } from "@/lib/amc/client-profile";
import { todayInDubai } from "@/lib/amc/contracts";
import { clientProfileService, type DocumentRecord } from "@/modules/amc-contracts/client-profile-service";

import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";

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
  const [uploading, setUploading] = useState(false);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const uploadTarget = "customerId" in target ? { level: "customer" as const, entityId: target.customerId } : target;
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
          {canUpload && data?.migrated !== false ? (
            <Button size="sm" variant="outline" onClick={() => setUploading(true)}>
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
        <div className="p-5">
          <EmptyState icon={<FileText className="size-5" />} title="No documents yet" description="Trade licences, title deeds, access passes, signed scans and photos are kept here." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Document</TableHead>
                <TableHead>Category</TableHead>
                {"customerId" in target ? <TableHead>For</TableHead> : null}
                <TableHead>Version</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => {
                const expiry = documentExpiryState(d.expiresOn, today);
                return (
                  <TableRow key={d.id} className={d.superseded ? "opacity-60" : undefined}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{d.title}</div>
                      <div className="text-muted-foreground text-xs">
                        {d.fileName} · {sizeLabel(d.sizeBytes)}
                      </div>
                    </TableCell>
                    <TableCell>{d.category}</TableCell>
                    {"customerId" in target ? <TableCell>{LEVEL_LABELS[d.level]}</TableCell> : null}
                    <TableCell className="tabular-nums">
                      v{d.version}
                      {d.superseded ? <span className="text-muted-foreground"> (earlier)</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatContractDate(d.uploadedAt.slice(0, 10))}
                      <div className="text-muted-foreground text-xs">{d.uploadedBy ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      {d.expiresOn ? (
                        <Badge
                          variant="secondary"
                          className={
                            expiry === "expired"
                              ? "bg-destructive/10 text-destructive border-none"
                              : expiry === "expiring"
                                ? "border-none bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : "border-none"
                          }
                        >
                          {expiry === "expired" ? "Expired " : expiry === "expiring" ? "Expires " : ""}
                          {formatContractDate(d.expiresOn)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${d.title}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => void download(d)}>
                            <Download className="size-4" />
                            Download
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
      )}
      {uploading ? (
        <UploadDialog
          level={uploadTarget.level}
          entityId={uploadTarget.entityId}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            reload();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function UploadDialog({
  level,
  entityId,
  onClose,
  onUploaded,
}: {
  level: DocumentLevel;
  entityId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const categories = DOCUMENT_CATEGORIES[level];
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(categories[0]);
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    if (file.size > AMC_DOCUMENT_MAX_BYTES) {
      setError("The file is larger than 20 MB.");
      return;
    }
    setBusy(true);
    setError(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>PDF, JPEG, PNG, WebP, Word or Excel, up to 20 MB. Kept privately; opened through a short-lived link.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="doc-file">File</Label>
            <Input
              ref={input}
              id="doc-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Category">
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
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
