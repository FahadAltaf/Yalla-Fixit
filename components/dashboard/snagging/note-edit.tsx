"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/*
  Editing what an inspector wrote on site -- a snag's note, a room's closing
  note, an access reason, a checklist reason, a verdict's comment -- from
  the portal. One pencil and one dialog, so every one of them edits the same
  way.
*/

/** The pencil beside a note, or "Add note" where there is none yet. */
export function NoteEditButton({
  hasNote,
  onClick,
  noun = "note",
}: {
  hasNote: boolean;
  onClick: () => void;
  /** What is being edited, for the label: "note", "reason", "comment". */
  noun?: string;
}) {
  /*
    A 16px square holding a 12px glyph: exactly the line box of the small
    text it sits beside, so it lines up with the first line rather than
    hanging below it and does not read as larger than the words it edits.
    It was a 14px glyph nudged down by a margin, which did both.
  */
  return hasNote ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${noun}`}
      title={`Edit ${noun}`}
      className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Pencil className="size-3" strokeWidth={1.75} />
    </button>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
    >
      <Plus className="size-3" strokeWidth={1.75} />
      Add {noun}
    </button>
  );
}

/**
 * Editing a short piece of text someone on site wrote: a snag's note, a
 * room's closing note, a reason, a verdict's comment. Empty text clears it. `seedKey`
 * reloads the text whenever a different record opens.
 */
export function NoteEditDialog({
  open,
  title,
  context,
  initial,
  seedKey,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  context: string;
  initial: string;
  seedKey: string | null;
  onClose: () => void;
  /** Saves the text (null to clear); throws with a message on failure. */
  onSave: (text: string | null) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  // Seeded when a different record opens, during render rather than in an effect.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seedKey !== seededFor) {
    setSeededFor(seedKey);
    setText(initial);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const unchanged = text.trim() === initial.trim();

  async function save() {
    if (saving || unchanged) return;
    setSaving(true);
    try {
      const next = text.trim() || null;
      await onSave(next);
      toast.success(next ? "Saved" : "Removed");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{context}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="snag-note">Note</Label>
          <Textarea
            id="snag-note"
            autoFocus
            rows={4}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="What the office and the client should know about this defect"
          />
          <p className="text-muted-foreground text-right text-xs tabular-nums">
            {text.length}/2000
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || unchanged}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
