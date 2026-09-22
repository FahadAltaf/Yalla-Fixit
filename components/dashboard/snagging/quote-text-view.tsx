"use client";

import type { RefObject } from "react";
import { Bold, Heading1, Heading2, List, ListOrdered } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inlineParts, parseScope, parseTerms } from "@/lib/snagging/quote-text";
import { cn } from "@/lib/utils";

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) =>
        part.bold ? (
          <strong key={index} className="text-foreground font-semibold">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The scope of work as the quotation prints it (point 14): bold, larger
 * headings, bold sub-headings, real bullets and **bold** words.
 */
export function ScopeView({ value, className }: { value?: string | null; className?: string }) {
  const blocks = parseScope(value);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("space-y-1 text-sm leading-relaxed", className)}>
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <p key={index} className={cn("text-foreground text-base font-bold", index > 0 && "pt-3")}>
            <Inline text={block.text} />
          </p>
        ) : block.kind === "subheading" ? (
          <p key={index} className={cn("text-foreground font-semibold", index > 0 && "pt-2")}>
            <Inline text={block.text} />
          </p>
        ) : block.kind === "bullet" ? (
          <p key={index} className="text-muted-foreground flex gap-2 pl-3">
            <span className="text-foreground font-bold" aria-hidden>
              •
            </span>
            <span>
              <Inline text={block.text} />
            </span>
          </p>
        ) : (
          <p key={index} className="text-muted-foreground">
            <Inline text={block.text} />
          </p>
        ),
      )}
    </div>
  );
}

/** The terms as the quotation prints them: numbered for you. */
export function TermsView({ value, className }: { value?: string | null; className?: string }) {
  const terms = parseTerms(value);
  if (terms.length === 0) return null;
  return (
    <ol className={cn("space-y-1.5 text-sm leading-relaxed", className)}>
      {terms.map((term) => (
        <li key={term.number} className="text-muted-foreground flex gap-2">
          <span className="text-foreground min-w-5 font-semibold tabular-nums">{term.number}.</span>
          <span>
            <Inline text={term.text} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Formatting buttons for a plain textarea: each writes the markup the
 * quotation reads, so nobody has to remember it. Heading, sub-heading and
 * bullet mark the lines the cursor is on; Bold wraps the selection.
 */
export function FormatToolbar({
  target,
  value,
  onChange,
  kinds,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  kinds: Array<"heading" | "subheading" | "bullet" | "number" | "bold">;
}) {
  function lineRange(el: HTMLTextAreaElement) {
    const start = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endBreak = value.indexOf("\n", el.selectionEnd);
    return { start, end: endBreak === -1 ? value.length : endBreak };
  }

  function markLines(prefix: string) {
    const el = target.current;
    if (!el) return;
    const { start, end } = lineRange(el);
    const lines = value.slice(start, end).split("\n").map((line) => {
      // Whatever marker the line had is replaced, so a heading can become a bullet.
      const bare = line.replace(/^(#{1,2}\s+|[-•*]\s+|\d+\s*[-.)]\s*)/, "");
      return bare ? `${prefix}${bare}` : bare;
    });
    let n = 0;
    const next =
      prefix === "#N "
        ? lines.map((line) => (line ? `${(n += 1)}- ${line.slice(3)}` : line))
        : lines;
    onChange(value.slice(0, start) + next.join("\n") + value.slice(end));
    requestAnimationFrame(() => el.focus());
  }

  function bold() {
    const el = target.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const picked = value.slice(a, b) || "bold text";
    onChange(`${value.slice(0, a)}**${picked}**${value.slice(b)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + 2, a + 2 + picked.length);
    });
  }

  const buttons = {
    heading: { label: "Heading", icon: Heading1, run: () => markLines("# ") },
    subheading: { label: "Sub-heading", icon: Heading2, run: () => markLines("## ") },
    bullet: { label: "Bullet", icon: List, run: () => markLines("- ") },
    number: { label: "Numbered", icon: ListOrdered, run: () => markLines("#N ") },
    bold: { label: "Bold", icon: Bold, run: bold },
  } as const;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {kinds.map((kind) => {
        const b = buttons[kind];
        return (
          <Button
            key={kind}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={b.run}
            title={b.label}
          >
            <b.icon className="size-3.5" aria-hidden />
            {b.label}
          </Button>
        );
      })}
    </div>
  );
}
