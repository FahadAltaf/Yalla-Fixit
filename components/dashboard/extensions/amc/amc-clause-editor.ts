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

import { textBlocks } from "./amc-contract-content";

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

/**
 * A clause list with one clause moved to the number typed for it.
 *
 * The number a clause prints under is not stored anywhere -- it is where
 * the clause sits -- so setting it to "7.2" means putting the clause
 * second under the seventh, and letting everything after it renumber. A
 * number typed and kept as a label would allow two 7.2s and a missing 8
 * inside a week; this cannot.
 *
 * Returns the new list, or why it could not be made.
 */
export function clauseListRenumbered<
  T extends { id: string; level: 1 | 2; enabled?: boolean },
>(list: T[], id: string, spec: string): { list: T[] } | { error: string } {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(spec.trim());
  if (!match) return { error: "Type a number like 7 or 7.2." };
  const major = Number(match[1]);
  const minor = match[2] ? Number(match[2]) : null;
  if (major < 1 || (minor !== null && minor < 1)) {
    return { error: "Numbering starts at 1." };
  }

  const moved = list.find((clause) => clause.id === id);
  if (!moved) return { error: "That clause is no longer in the list." };

  /* The list without it, which is what the new number counts against. */
  const rest = list.filter((clause) => clause.id !== id);

  /* Where each remaining clause sits, walked exactly as the numbers are. */
  const majors: number[] = [];
  const subsOf = new Map<number, number[]>();
  let seen = 0;
  rest.forEach((clause, index) => {
    if (clause.enabled === false) return;
    if (clause.level === 1) {
      seen += 1;
      majors.push(index);
      subsOf.set(seen, []);
    } else if (seen > 0) {
      subsOf.get(seen)?.push(index);
    }
  });

  let at: number;
  if (minor === null) {
    /* The Nth whole clause, or the end when the list is shorter. */
    at = major <= majors.length ? majors[major - 1] : rest.length;
  } else {
    if (major > majors.length) {
      return { error: `There is no clause ${major} for it to sit under.` };
    }
    const subs = subsOf.get(major) ?? [];
    if (minor <= subs.length) at = subs[minor - 1];
    /* Past the last sub-clause: just before the next whole one. */
    else at = major < majors.length ? majors[major] : rest.length;
  }

  const next = [...rest];
  next.splice(at, 0, { ...moved, level: minor === null ? 1 : (2 as const) });
  return { list: next };
}

/**
 * Clauses that print no heading of their own: they run on from the one
 * above, so the number they appear under is that one's, not a number of
 * their own. The bank table continues the "Modes of Payment" term, the
 * confirmation continues Termination, and so on.
 *
 * Kept in step with NO_HEADING in `amc-document-model.ts`, which is what
 * decides it when the contract is drawn.
 */
const RUNS_ON = new Set([
  "excludedOffer",
  "bankDetails",
  "invoiceTerms",
  "contractConfirmation",
  "signatures",
]);

/** Clauses the contract leaves out; they belong to the proposal. */
const PROPOSAL_ONLY = new Set(["proposalNotes", "proposalAcceptance"]);

export type ClauseNumber = {
  /** What the contract shows against it. */
  number: string;
  /** It is the clause above's: this one prints no heading of its own. */
  inherited: boolean;
};

type Numberable = {
  id: string;
  role?: string;
  level: 1 | 2;
  body?: string;
  enabled?: boolean;
};

/**
 * What each clause prints under, walked exactly as the document draws it.
 *
 * Not simply "count the clauses": two of them number things of their own
 * and take the sub-numbers to do it -- the services clause takes one per
 * service, and the general terms take one per term, which is how Bank
 * Details comes out at 7.16 rather than 7.1. A clause that prints no
 * heading takes the number of whatever it runs on from.
 *
 * `scopeSections` is how many services print a scope, which on a real
 * contract is the ones that proposal selected; the full list is the right
 * answer for settings, where there is no proposal yet.
 */
export function clauseNumbering(
  list: Numberable[],
  options?: { scopeSections?: number },
): Map<string, ClauseNumber> {
  const sections = Math.max(0, options?.scopeSections ?? 0);
  const numbers = new Map<string, ClauseNumber>();
  let major = 0;
  let minor = 0;
  /* The last number the contract actually printed. */
  let printed = "";

  for (const clause of list) {
    if (clause.enabled === false) continue;
    if (clause.role && PROPOSAL_ONLY.has(clause.role)) continue;

    let number: string;
    if (clause.level === 1) {
      major += 1;
      minor = 0;
      number = String(major);
    } else {
      minor += 1;
      number = `${major}.${minor}`;
    }

    if (clause.role && RUNS_ON.has(clause.role)) {
      /* It still takes a sub-number, as the builder does -- it simply
         never shows one. What it shows is where it prints. */
      numbers.set(clause.id, { number: printed, inherited: true });
      continue;
    }

    if (clause.role === "scopeServices") {
      /* One number per service, and the clauses after carry on past them. */
      const from = minor;
      minor += Math.max(0, sections - 1);
      number = `${major}.${from}`;
      numbers.set(clause.id, { number, inherited: false });
      printed = `${major}.${Math.max(from, minor)}`;
      continue;
    }

    numbers.set(clause.id, { number, inherited: false });
    printed = number;

    if (clause.role === "generalTerms") {
      /*
        The terms number themselves from this clause -- 7.1, 7.2 ... -- so
        they take those sub-numbers, and the last of them is what the
        clauses running on below it print under.
      */
      const terms = textBlocks(clause.body).filter((line) =>
        /^\d+\.\d+\s/.test(line),
      ).length;
      if (terms > 0) {
        minor += terms;
        printed = `${number}.${terms}`;
      }
    }
  }
  return numbers;
}
