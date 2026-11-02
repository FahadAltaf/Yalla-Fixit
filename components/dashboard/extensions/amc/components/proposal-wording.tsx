"use client";

import { useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { FileText, Pencil, RotateCcw, TriangleAlert } from "lucide-react";

import { QuoteRichText } from "@/components/dashboard/snagging/quote-rich-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { clauseTextToHtml, htmlToClauseText, roundTrips } from "../amc-clause-editor";
import { contractClauseNumbers, contractClauseReferences } from "../amc-document-model";
import { AMC_CLAUSE_STRUCTURE_ROLES, type AmcSettings } from "../amc-settings";
import { isCustomServiceRow, type AmcComputedData, type AmcFormData } from "../amc-types";

/*
  Clauses the team does not word here: the structures (services, table,
  signatures) have no text, the proposal's closing pages are not on the
  contract, and the handyman rates are entered in step 2.
*/
const NOT_EDITABLE = new Set<string>([
  ...AMC_CLAUSE_STRUCTURE_ROLES,
  "proposalNotes",
  "proposalAcceptance",
  "handymanRates",
]);

type Item = {
  kind: "clause" | "scope";
  /* Clause id, or service id for a scope. */
  id: string;
  number: string;
  title: string;
  /* The AMC Settings text. */
  standard: string;
  /* What this proposal prints. */
  value: string;
  edited: boolean;
};

/* Filled from the proposal when the document is built: {{handymanHours}}, {{clause:materials}}, {{term}}. */
function placeholdersIn(text: string): string[] {
  return [...new Set(text.match(/\{\{\s*[\w:]+\s*\}\}/g) ?? [])];
}

function firstLine(text: string): string {
  return (
    text
      .split(/\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

/**
 * The contract's wording on this proposal (DEV-263).
 *
 * Every clause starts from AMC Settings. Editing one here saves the new
 * text with this proposal only, the way quotation text is edited in FSM,
 * and never changes the default. Placeholders stay in the text and are
 * filled from the service table, so an edited clause cannot quote a
 * frequency or a count the table does not have.
 */
export function ProposalWording({
  form,
  computed,
  settings,
  onSaved,
}: {
  form: UseFormReturn<AmcFormData>;
  /* Saves the draft, so an edit is kept without moving to another step. */
  onSaved?: () => void;
  /* Built with this proposal's edits, so its numbering is the contract's. */
  computed: AmcComputedData;
  /* AMC Settings without this proposal's edits: the standard text. */
  settings: AmcSettings;
}) {
  const clauseOverrides = form.watch("clauseOverrides") ?? {};
  const scopeOverrides = form.watch("scopeOverrides") ?? {};
  const serviceRows = form.watch("serviceRows");

  const items = useMemo<Item[]>(() => {
    const contract = { ...computed, documentType: "contract" as const };
    const numbers = contractClauseNumbers(contract);
    const references = contractClauseReferences(contract);
    const out: Item[] = [];

    for (const clause of settings.clauseList) {
      if (clause.role && NOT_EDITABLE.has(clause.role)) continue;
      const number = numbers.get(clause.id);
      // Not on this contract: switched off, or a call-out that was not bought.
      if (!number) continue;
      // A heading with no text of its own has nothing to word.
      if (!clause.role && !clause.body.trim()) continue;
      const override = clauseOverrides[clause.id];
      out.push({
        kind: "clause",
        id: clause.id,
        number,
        title: clause.title,
        standard: clause.body,
        value: override ?? clause.body,
        edited: typeof override === "string",
      });
    }

    // Each standard service's scope prints as its own clause (2.x).
    for (const row of computed.frequencyRows) {
      if (isCustomServiceRow(row)) continue; // worded in its own dialog in step 2
      const service = settings.services.find((item) => item.id === row.serviceId);
      if (!service || service.hasScopeSection === false) continue;
      const reference = references.get(row.serviceId) ?? "";
      const override = scopeOverrides[row.serviceId];
      const standard = settings.serviceScopes[row.serviceId] ?? "";
      out.push({
        kind: "scope",
        id: row.serviceId,
        number: reference.replace(/^\D*/, ""),
        title: (service.sectionTitle ?? service.label).replace(/:\s*$/, ""),
        standard,
        value: override ?? standard,
        edited: typeof override === "string",
      });
    }

    const order = (number: string) => number.split(".").map((part) => Number(part) || 0);
    return out.sort((a, b) => {
      const [x, y] = [order(a.number), order(b.number)];
      return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0);
    });
    // serviceRows: which scopes are on the contract.
  }, [computed, settings, clauseOverrides, scopeOverrides, serviceRows]);

  const [open, setOpen] = useState<Item | null>(null);
  /*
    HTML while the rich editor is used, plain text in the plain box. Kept
    as the editor emits it rather than converted on every keystroke, which
    would rebuild the editor under the cursor (an empty new paragraph has
    no stored form, so Enter would undo itself).
  */
  const [draft, setDraft] = useState("");
  const [rich, setRich] = useState(true);
  const draftText = rich ? htmlToClauseText(draft) : draft;
  const begin = (item: Item, text: string) => {
    const useRich = roundTrips(text);
    setRich(useRich);
    setDraft(useRich ? clauseTextToHtml(text) : text);
  };
  const editedCount = items.filter((item) => item.edited).length;

  const field = (item: Item) => (item.kind === "clause" ? "clauseOverrides" : "scopeOverrides");

  const write = (item: Item, text: string) => {
    const name = field(item);
    const next = { ...(form.getValues(name) ?? {}) };
    // Back to the standard text is no edit at all.
    if (text.trim() === item.standard.trim()) delete next[item.id];
    else next[item.id] = text;
    form.setValue(name, next, { shouldDirty: true });
    onSaved?.();
  };

  const missing = open
    ? placeholdersIn(open.standard).filter((token) => !draftText.includes(token))
    : [];

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="text-brand size-4" />
          Contract wording
        </h3>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Each clause starts from AMC Settings. Edits apply to this proposal only and never change
          the standard text.
          {editedCount > 0
            ? ` ${editedCount} ${editedCount === 1 ? "clause is" : "clauses are"} edited.`
            : ""}
        </p>
      </div>

      <div className="max-h-[28rem] divide-y overflow-y-auto rounded-lg border">
        {items.map((item) => (
          <div key={`${item.kind}-${item.id}`} className="flex items-start gap-3 px-4 py-3">
            <span className="text-muted-foreground w-10 shrink-0 pt-0.5 text-sm tabular-nums">
              {item.number}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{item.title}</span>
                {item.edited ? (
                  <Badge variant="secondary" className="border-0 text-[11px]">
                    Edited for this proposal
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {firstLine(item.value) || "No text"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              aria-label={`Edit ${item.title}`}
              onClick={() => {
                begin(item, item.value);
                setOpen(item);
              }}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => (next ? null : setOpen(null))}>
        <DialogContent className="sm:max-w-2xl">
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {open.number} {open.title}
                </DialogTitle>
                <DialogDescription>
                  Saved with this proposal only. AMC Settings keeps the standard text for every
                  other proposal.
                </DialogDescription>
              </DialogHeader>

              {rich ? (
                <QuoteRichText
                  key={`${open.kind}-${open.id}`}
                  ariaLabel={open.title}
                  value={draft}
                  onChange={setDraft}
                  tools={["subheading", "bullet"]}
                  placeholder="Each paragraph prints as its own block, in the order shown."
                />
              ) : (
                <Textarea
                  rows={14}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-72 font-mono text-[13px] leading-relaxed"
                />
              )}

              {missing.length > 0 ? (
                <p className="text-destructive flex items-start gap-1.5 text-xs">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    Put back {missing.join(", ")}. It is filled in from the service table, so the
                    clause cannot say something the table does not.
                  </span>
                </p>
              ) : placeholdersIn(open.standard).length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Text in double braces, such as {placeholdersIn(open.standard)[0]}, is filled in
                  from this proposal&apos;s services. Keep it where it is.
                </p>
              ) : null}

              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={draftText.trim() === open.standard.trim()}
                  onClick={() => begin(open, open.standard)}
                >
                  <RotateCcw className="size-4" />
                  Use the standard text
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={missing.length > 0}
                    onClick={() => {
                      write(open, draftText);
                      setOpen(null);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
