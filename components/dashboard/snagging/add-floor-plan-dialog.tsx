"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/actions/utils";

export const FLOOR_PLAN_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

function isAccepted(file: File) {
  return FLOOR_PLAN_ACCEPT.split(",").includes(file.type);
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Add-a-floor-plan flow.
 *
 * Replaces an inline label box next to a file picker, where the label was
 * optional and silently fell back to "Floor N" -- so a plan could be added
 * with no meaningful name and no obvious way to tell two apart. Here both
 * the label and the file are required, and the submit stays disabled until
 * each is present.
 */
export default function AddFloorPlanDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (label: string, file: File) => Promise<void> | void;
  pending?: boolean;
}) {
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit = label.trim().length > 0 && file !== null && !pending;

  const reset = () => {
    setLabel("");
    setFile(null);
    setError(null);
    setDragging(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const take = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!isAccepted(candidate)) {
      setError("Floor plans must be a PNG, JPG, WEBP or PDF.");
      return;
    }
    setError(null);
    setFile(candidate);
  };

  const handleOpenChange = (next: boolean) => {
    // Closing discards the draft, so re-opening never resurrects a
    // half-filled form from last time.
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!canSubmit || !file) return;
    await onSubmit(label.trim(), file);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add floor plan</DialogTitle>
          <DialogDescription>
            One plan per floor. Areas are then pinned to their place on it. A PDF is converted to an
            image in your browser, which can take a moment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="floor-plan-label">
              Label <span className="text-destructive">*</span>
            </Label>
            <Input
              id="floor-plan-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Ground floor"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="floor-plan-file">
              Plan file <span className="text-destructive">*</span>
            </Label>

            <input
              ref={fileRef}
              id="floor-plan-file"
              type="file"
              accept={FLOOR_PLAN_ACCEPT}
              hidden
              onChange={(e) => take(e.target.files?.[0])}
            />

            {file ? (
              // Once chosen, show what was chosen -- a dropzone that still
              // says "drop a file here" gives no confirmation anything took.
              <div className="flex items-center gap-3 rounded-md border p-3">
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                  {file.type === "application/pdf" ? (
                    <FileText className="size-4" />
                  ) : (
                    <ImageIcon className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-muted-foreground text-xs">{humanSize(file.size)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  disabled={pending}
                  aria-label="Remove selected file"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  take(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
                  <Upload className="size-5" />
                </span>
                <span className="text-sm font-medium">Click to upload, or drag a file here</span>
                <span className="text-muted-foreground text-xs">PNG, JPG, WEBP or PDF</span>
              </button>
            )}

            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          {/* Disabled until BOTH fields are filled, so the requirement is
              visible before the click rather than after a failed submit. */}
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? "Processing…" : "Add plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
