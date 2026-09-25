/**
 * The bridge between the stored quotation wording and a rich text editor.
 *
 * The scope and the terms are stored in the small dialect `quote-text.ts`
 * reads -- `# heading`, `## sub-heading`, `- bullet`, `**bold**`, terms
 * numbered `1-` -- and that dialect is what the client-facing PDF and Word
 * file are built from. An editor cannot simply store HTML instead without
 * every existing quotation losing its formatting, so the editor is given
 * HTML here and its HTML is turned back into the dialect on save.
 *
 * The invariant this has to hold is NOT that the text survives byte for
 * byte. `parseScope` reads a short unpunctuated line as a sub-heading even
 * when nobody wrote `##`, so a round trip legitimately makes that marker
 * explicit and the stored text changes. What must never change is what the
 * client sees: for every input, `parseScope(toDialect(toHtml(input)))`
 * must equal `parseScope(input)`. `quote-editor.test.ts` asserts exactly
 * that, over the wording actually in the database.
 */

import {
  inlineParts,
  parseScope,
  parseTerms,
  type ScopeBlock,
} from "./quote-text";

/** HTML-escape a run of text, so wording with < or & survives the trip. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `**bold**` to `<strong>`, on one line. */
function inlineToHtml(text: string): string {
  return inlineParts(text)
    .map((part) => (part.bold ? `<strong>${esc(part.text)}</strong>` : esc(part.text)))
    .join("");
}

/* ─────────────────────────────── to HTML ─────────────────────────────── */

/**
 * The scope as the editor should show it.
 *
 * Consecutive bullets are collected into one list, because a list item is
 * only a list item to the editor when it sits inside one.
 */
export function scopeToHtml(raw: string | null | undefined): string {
  const blocks = parseScope(raw);
  const out: string[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    out.push(`<ul>${bullets.map((b) => `<li><p>${b}</p></li>`).join("")}</ul>`);
    bullets = [];
  };

  for (const block of blocks) {
    const html = inlineToHtml(block.text);
    if (block.kind === "bullet") {
      bullets.push(html);
      continue;
    }
    flush();
    if (block.kind === "heading") out.push(`<h1>${html}</h1>`);
    else if (block.kind === "subheading") out.push(`<h2>${html}</h2>`);
    else out.push(`<p>${html}</p>`);
  }
  flush();

  return out.join("") || "<p></p>";
}

/** The terms as the editor should show them: one ordered list. */
export function termsToHtml(raw: string | null | undefined): string {
  const items = parseTerms(raw);
  if (items.length === 0) return "<p></p>";
  return `<ol>${items
    .map((item) => `<li><p>${inlineToHtml(item.text)}</p></li>`)
    .join("")}</ol>`;
}

/* ────────────────────────────── from HTML ────────────────────────────── */

type Node = { tag: string; inner: string };

/**
 * The top-level blocks of the editor's HTML.
 *
 * A parser rather than a regex over the whole string: a list contains
 * further tags, and matching `<ul>.*?</ul>` non-greedily breaks on the
 * first nested `</p>`. This walks the string and tracks depth instead.
 */
function topLevelNodes(html: string): Node[] {
  const nodes: Node[] = [];
  const open = /<(h1|h2|p|ul|ol)(?:\s[^>]*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = open.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const start = match.index + match[0].length;
    const closing = new RegExp(`</?${tag}(?:\\s[^>]*)?>`, "gi");
    closing.lastIndex = start;
    let depth = 1;
    let end = html.length;
    let step: RegExpExecArray | null;

    while ((step = closing.exec(html)) !== null) {
      depth += step[0][1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = step.index;
        break;
      }
    }

    nodes.push({ tag, inner: html.slice(start, end) });
    open.lastIndex = Math.max(end, start);
  }
  return nodes;
}

/** `<strong>` back to `**bold**`, and entities back to characters. */
function inlineToDialect(html: string): string {
  return html
    .replace(/<\/?(?:strong|b)(?:\s[^>]*)?>/gi, "**")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    /*
      An empty pair, left by bold with nothing in it. Dropped rather than
      written out, because `****` reads as literal asterisks in the PDF.
    */
    .replace(/\*\*\s*\*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The `<li>` texts of a list, in order. */
function listItems(inner: string): string[] {
  const items: string[] = [];
  const open = /<li(?:\s[^>]*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = open.exec(inner)) !== null) {
    const start = match.index + match[0].length;
    const closing = /<\/?li(?:\s[^>]*)?>/gi;
    closing.lastIndex = start;
    let depth = 1;
    let end = inner.length;
    let step: RegExpExecArray | null;
    while ((step = closing.exec(inner)) !== null) {
      depth += step[0][1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = step.index;
        break;
      }
    }
    const text = inlineToDialect(inner.slice(start, end));
    if (text) items.push(text);
    open.lastIndex = Math.max(end, start);
  }
  return items;
}

/**
 * The editor's HTML back to the stored scope dialect.
 *
 * Every block is written with its marker, including a sub-heading the
 * reader typed as plain text. Making the implicit explicit is the point:
 * it is what stops the 60-character heuristic re-reading the same line
 * differently the next time somebody edits around it.
 */
export function htmlToScope(html: string): string {
  const lines: string[] = [];
  for (const node of topLevelNodes(html)) {
    if (node.tag === "ul" || node.tag === "ol") {
      for (const item of listItems(node.inner)) lines.push(`- ${item}`);
      continue;
    }
    const text = inlineToDialect(node.inner);
    if (!text) continue;
    if (node.tag === "h1") lines.push(`# ${text}`);
    else if (node.tag === "h2") lines.push(`## ${text}`);
    else lines.push(text);
  }
  return lines.join("\n");
}

/**
 * The editor's HTML back to the stored terms dialect.
 *
 * Numbered `1-`, which is the form `parseTerms` numbers from and the form
 * the existing wording is already written in. A paragraph outside the list
 * still becomes a term, since that is how `parseTerms` reads a line.
 */
export function htmlToTerms(html: string): string {
  const lines: string[] = [];
  for (const node of topLevelNodes(html)) {
    if (node.tag === "ol" || node.tag === "ul") {
      for (const item of listItems(node.inner)) lines.push(item);
      continue;
    }
    const text = inlineToDialect(node.inner);
    if (text) lines.push(text);
  }
  return lines.map((text, index) => `${index + 1}- ${text}`).join("\n");
}

/* ─────────────────────────── the safety check ────────────────────────── */

/** What the client sees, as a comparable string. */
export function scopeFingerprint(raw: string | null | undefined): string {
  return parseScope(raw)
    .map((block: ScopeBlock) => `${block.kind}:${block.text.replace(/\s+/g, " ")}`)
    .join("\n");
}

export function termsFingerprint(raw: string | null | undefined): string {
  return parseTerms(raw)
    .map((item) => `${item.number}:${item.text.replace(/\s+/g, " ")}`)
    .join("\n");
}
