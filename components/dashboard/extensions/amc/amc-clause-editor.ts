/**
 * The clause and scope wording, between how it is stored and how it is
 * edited.
 *
 * AMC stores a clause as blank-line separated blocks of plain text, and
 * the contract builder reads those blocks -- a block is a paragraph, a
 * bullet or a term depending on which clause it belongs to. The editor
 * works in HTML, as the snagging quotation's does, so an admin sees the
 * blocks as blocks instead of counting blank lines in a textarea.
 *
 * Only what the stored format can express is converted, in both
 * directions, and `roundTrips` below is the check that says so: anything
 * the editor cannot represent exactly is better left to the plain box
 * than silently rewritten in a document somebody signs.
 */


const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** The blocks of a stored clause, without the blank lines between them. */
export function clauseBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * Stored text as HTML.
 *
 * A block that ends in a colon is a sub-heading -- that is how the
 * contract's materials clause has always marked one -- so it is shown as
 * one. Everything else is a paragraph.
 */
export function clauseTextToHtml(text: string | null | undefined): string {
  const blocks = clauseBlocks(text ?? "");
  if (blocks.length === 0) return "<p></p>";
  return blocks
    .map((block) =>
      /:$/.test(block)
        ? `<h2>${escape(block.replace(/:$/, ""))}</h2>`
        : `<p>${escape(block.replace(/\n/g, " "))}</p>`,
    )
    .join("");
}

/**
 * HTML back to stored text.
 *
 * Every block the editor can produce -- paragraph, list item, heading --
 * is one stored block, because that is all the format has. A heading
 * takes its colon back.
 */
export function htmlToClauseText(html: string): string {
  if (typeof document === "undefined") return html;
  const holder = document.createElement("div");
  holder.innerHTML = html;

  const blocks: string[] = [];
  for (const node of Array.from(holder.children)) {
    const tag = node.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      for (const item of Array.from(node.children)) {
        const text = (item.textContent ?? "").trim();
        if (text) blocks.push(text);
      }
      continue;
    }
    const text = (node.textContent ?? "").trim();
    if (!text) continue;
    blocks.push(tag === "h1" || tag === "h2" ? `${text.replace(/:$/, "")}:` : text);
  }
  return blocks.join("\n\n");
}

/**
 * Whether this text survives a trip through the editor unchanged.
 *
 * Used to decide, per clause, whether to offer the editor at all: a
 * clause whose wording the editor would alter keeps the plain box, where
 * what is typed is exactly what is stored.
 *
 * The one thing the editor cannot keep is a line break inside a block --
 * a paragraph is a paragraph -- so that is what this looks for. Kept a
 * plain predicate rather than an actual round trip so it answers the
 * same on the server as in the browser, and the page does not render one
 * editor and then hydrate into the other.
 */
export function roundTrips(text: string | null | undefined): boolean {
  return clauseBlocks(text ?? "").every((block) => !block.includes("\n"));
}
