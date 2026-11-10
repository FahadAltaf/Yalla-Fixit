"use client";

import { useRef, useState } from "react";
import { FileText, History, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { complianceService, type ComplianceDocument } from "@/modules/compliance";
import { formatDateOnly } from "./status-pill";

/**
 * Files attached to one compliance item (Sharon's action point C2).
 * Shown only to holders of the identity-numbers right; the server enforces
 * the same. The newest file is current; older ones are listed as history.
 */
export function ItemDocuments({
  employeeId,
  itemKey,
  expiryDate,
  documents,
  canUpload,
  onChanged,
}: {
  employeeId: string;
  itemKey: string;
  expiryDate: string | null;
  documents: ComplianceDocument[];
  canUpload: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const current = documents.find((d) => d.current) ?? null;
  const history = documents.filter((d) => !d.current);

  const open = async (doc: ComplianceDocument) => {
    try {
      const { url } = await complianceService.openDocument(employeeId, doc.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the file");
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await complianceService.uploadDocument(employeeId, itemKey, file, expiryDate);
      toast.success(current ? "New file attached; the previous one is kept as history" : "File attached");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1 text-xs" id={`doc-${itemKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => void open(current)}>
            <FileText className="size-3.5" /> {current.file_name}
          </Button>
        ) : (
          <span className="text-muted-foreground">No file</span>
        )}
        {canUpload ? (
          <>
            <input
              ref={input}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              id={`doc-input-${itemKey}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button type="button" variant="outline" size="sm" className="h-7 px-2" disabled={busy} onClick={() => input.current?.click()}>
              <Paperclip className="size-3.5" /> {busy ? "Uploading…" : current ? "Replace" : "Attach"}
            </Button>
          </>
        ) : null}
        {history.length ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowHistory((v) => !v)}>
            <History className="size-3.5" /> {history.length} earlier
          </Button>
        ) : null}
      </div>
      {showHistory ? (
        <ul className="border-l pl-3">
          {history.map((d) => (
            <li key={d.id}>
              <button type="button" className="hover:underline" onClick={() => void open(d)}>
                {d.file_name}
              </button>
              <span className="text-muted-foreground">
                {" "}· uploaded {formatDateOnly(d.created_at.slice(0, 10))}
                {d.expiry_date ? ` · expiry then ${formatDateOnly(d.expiry_date)}` : ""}
                {d.uploader ? ` · ${d.uploader}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
