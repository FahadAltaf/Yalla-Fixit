/**
 * The scope of work and the terms, read from the plain text an admin types
 * in Settings (point 14). One reader for the quotation PDF, the Word file
 * and the Settings preview, so the three always agree.
 *
 * Scope, line by line:
 *   # Heading          bold and larger
 *   ## Sub-heading     bold
 *   - item  (or • *)   a bullet
 *   anything else      a paragraph; a short line with no closing
 *                      punctuation is read as a sub-heading, which is how
 *                      scopes typed before this markup were written
 *
 * Terms: numbered for you. Lines typed "1-", "1." or "1)" each start a
 * term and the lines after them continue it; text with no numbers at all
 * is one term per line.
 *
 * Inside any line, **words** are bold.
 */

export type ScopeBlock = {
  kind: "heading" | "subheading" | "bullet" | "text";
  text: string;
};

export type TermItem = { number: number; text: string };

export type InlinePart = { text: string; bold: boolean };

const BULLET = /^[-•*]\s+/;
const NUMBERED = /^(\d+)\s*[-.)]\s*/;

export function parseScope(raw: string | null | undefined): ScopeBlock[] {
  return (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ScopeBlock => {
      if (line.startsWith("## ")) return { kind: "subheading", text: line.slice(3).trim() };
      if (line.startsWith("# ")) return { kind: "heading", text: line.slice(2).trim() };
      if (BULLET.test(line)) return { kind: "bullet", text: line.replace(BULLET, "") };
      const plain = line.replace(/\*\*/g, "");
      if (plain.length < 60 && !/[.;:!?]$/.test(plain)) return { kind: "subheading", text: line };
      return { kind: "text", text: line };
    });
}

export function parseTerms(raw: string | null | undefined): TermItem[] {
  const lines = (raw ?? "")
    .replace(/^\s*Notes:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const anyNumbered = lines.some((line) => NUMBERED.test(line));
  const items: string[] = [];
  for (const line of lines) {
    if (!anyNumbered || NUMBERED.test(line) || items.length === 0) {
      items.push(line.replace(NUMBERED, ""));
    } else {
      // A line under a numbered term carries on that term.
      items[items.length - 1] = `${items[items.length - 1]} ${line}`;
    }
  }
  return items.map((text, index) => ({ number: index + 1, text }));
}

/** Splits a line on **bold** markers. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts.length > 0 ? parts : [{ text, bold: false }];
}
