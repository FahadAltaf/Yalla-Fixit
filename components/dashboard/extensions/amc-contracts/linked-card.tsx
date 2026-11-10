"use client";

import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";

/**
 * The client or property picked on a form (new proposal, new enquiry): its
 * name, one line of detail, then Edit and Change. One look for both forms.
 */
export function LinkedCard({
  title,
  detail,
  note,
  noteTone = "muted",
  onEdit,
  editLabel,
  onChange,
  busy = false,
}: {
  title: string;
  detail: string;
  note?: string;
  /** "warning" when the note is something to fix (an address missing what a site visit needs). */
  noteTone?: "muted" | "warning";
  onEdit?: () => void;
  editLabel: string;
  onChange: () => void;
  busy?: boolean;
}) {
  return (
    <div className="border-brand/30 bg-brand-50/50 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <TruncatedText className="font-medium">{title}</TruncatedText>
        <p className="text-muted-foreground text-xs">{detail}</p>
        {note ? <p className={noteTone === "warning" ? "text-warning mt-0.5 text-xs" : "text-muted-foreground mt-0.5 text-xs"}>{note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} disabled={busy}>
            <Pencil className="size-3.5" />
            {editLabel}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onChange} disabled={busy}>
          Change
        </Button>
      </div>
    </div>
  );
}

/** The full address as it prints on the contract: the line on file, then the building and area. */
export function printedAddress(p: {
  label: string;
  address: string | null;
  building: string | null;
  community: string | null;
  street: string | null;
  city: string | null;
}): string {
  const parts = [p.address || p.label, p.building, p.street, p.community, p.city]
    .map((x) => x?.trim())
    .filter(Boolean) as string[];
  return [...new Set(parts)].join(", ");
}
