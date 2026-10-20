"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/actions/utils";
import { todosService } from "@/modules/todos";
import type { TodoAttachment } from "@/types/types";
import { userLabel } from "./todo-helpers";

/*
  FR-16: the pieces of the file experience on a todo, used by the dialog's
  Files section, by the comment composer (files posted with a comment) and
  by the create form (files queued until the todo exists).

  The API checks every file's bytes against the allowlist and hands out
  one-hour signed links; delete is for the uploader and the todo's owner.
*/

export const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.heic,.heif";
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_TYPES_LABEL = "PDF, Word, Excel, CSV, PNG, JPG or HEIC, up to 25 MB each";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ name, contentType, className }: { name: string; contentType?: string; className?: string }) {
  const lower = name.toLowerCase();
  if (contentType?.startsWith("image/") || /\.(png|jpe?g|heic|heif)$/.test(lower)) return <ImageIcon className={className} />;
  if (/\.(xlsx|csv)$/.test(lower) || contentType?.includes("sheet") || contentType === "text/csv") {
    return <FileSpreadsheet className={className} />;
  }
  return <FileText className={className} />;
}

/** Uploads files one by one; refuses oversize ones up front. Returns how many landed. */
export async function uploadFiles(todoId: string, files: File[], commentId?: string): Promise<number> {
  let added = 0;
  for (const file of files) {
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error(`${file.name} is larger than 25 MB`);
      continue;
    }
    try {
      await todosService.uploadAttachment(todoId, file, commentId);
      added += 1;
    } catch (error) {
      toast.error(error instanceof Error ? `${file.name}: ${error.message}` : `Failed to upload ${file.name}`);
    }
  }
  return added;
}

/** A button that opens the file picker and hands back the chosen files. */
export function FilePickerButton({
  onPick,
  disabled,
  busy,
  label = "Attach files",
  size = "sm",
  variant = "outline",
  iconOnly,
}: {
  onPick: (files: File[]) => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  size?: "sm" | "xs" | "icon-xs" | "icon-sm";
  variant?: "outline" | "ghost" | "secondary";
  iconOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onPick(files);
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        aria-label={label}
        title={label}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
        {!iconOnly && (busy ? "Uploading…" : label)}
      </Button>
    </>
  );
}

/** Files chosen but not uploaded yet (a new todo, or a comment being written). */
export function QueuedFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file, index) => {
        return (
          <li
            key={`${file.name}-${file.size}-${index}`}
            className="bg-muted text-foreground flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
          >
            <FileIcon name={file.name} contentType={file.type} className="text-muted-foreground size-3.5 shrink-0" />
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
            <span className="text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
              onClick={() => onRemove(index)}
              aria-label={`Remove ${file.name}`}
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One uploaded file: name, size, who and when, download, delete. */
export function AttachmentItem({
  attachment,
  canDelete,
  onDelete,
  compact,
}: {
  attachment: TodoAttachment;
  canDelete: boolean;
  onDelete: (attachment: TodoAttachment) => void;
  compact?: boolean;
}) {
  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-md border bg-card",
        compact ? "px-2.5 py-1.5" : "p-3",
      )}
    >
      <FileIcon name={attachment.file_name} contentType={attachment.content_type} className="text-muted-foreground size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {attachment.signed_url ? (
          <a
            href={attachment.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium hover:underline"
            title={attachment.file_name}
          >
            {attachment.file_name}
          </a>
        ) : (
          <div className="truncate text-sm font-medium" title={attachment.file_name}>
            {attachment.file_name}
          </div>
        )}
        <div className="text-muted-foreground truncate text-xs">
          {formatBytes(attachment.size_bytes)}
          {!compact && (
            <>
              {" · "}
              {userLabel(attachment.uploader ?? undefined)}
              {" · "}
              {new Date(attachment.created_at).toLocaleString()}
            </>
          )}
          {!attachment.signed_url && " · file missing"}
        </div>
      </div>
      {attachment.signed_url && (
        <Button asChild size="icon-xs" variant="ghost" aria-label={`Download ${attachment.file_name}`}>
          <a href={attachment.signed_url} target="_blank" rel="noopener noreferrer">
            <Download className="size-3.5" />
          </a>
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Delete ${attachment.file_name}`}
          onClick={() => onDelete(attachment)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
