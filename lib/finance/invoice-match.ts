/**
 * Matching a scanned MAHER invoice to work-order lines (decided with the
 * user, 22 Oct): the AI reads the invoice; this proposes which line items
 * it covers and how much of each, for a person to confirm. Pure, so the
 * rules are tested with exact cases and nothing is recorded by a guess.
 *
 * Rules:
 *  - A work order or quotation number printed on the invoice (on a line, or
 *    anywhere on it) narrows the candidates to that work order's lines.
 *  - A scanned amount equal to a line's amount left, or to the line's full
 *    amount, is strong evidence; one that equals it plus 5 % VAT is read as
 *    VAT-inclusive and proposed without the VAT (amounts are before VAT).
 *  - Words shared between the scanned description and the line's name and
 *    description count too.
 *  - A number alone is not enough: the amount must fit the line, or the
 *    descriptions must overlap. A scanned amount larger than the line has
 *    left counts against it.
 *  - Each line is proposed once, best match first; nothing is proposed
 *    beyond what the line has left to invoice; weak matches are left for
 *    the person to choose.
 */

export type ScannedLine = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  /** A work order or quotation number printed against the line, if any. */
  reference: string | null;
};

export type ScannedInvoice = {
  invoiceNumber: string | null;
  /** YYYY-MM-DD. */
  invoiceDate: string | null;
  currency: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  /** Work order or quotation numbers printed anywhere on the invoice. */
  references: string[];
  lines: ScannedLine[];
};

export type CandidateLine = {
  workOrderId: string;
  workOrderNumber: string | null;
  quotationNumber: string | null;
  lineId: string;
  name: string | null;
  description: string | null;
  /** Before VAT. */
  amount: number;
  /** FSM's Line_Item_Amount, VAT included. */
  amountWithVat: number | null;
  remaining: number;
};

export type Confidence = "high" | "medium" | "low";

export type Proposal = {
  scannedIndex: number;
  candidate: CandidateLine;
  /** Before VAT, never more than the line has left. */
  amount: number;
  confidence: Confidence;
  /** Why, in words the person reads before confirming. */
  reasons: string[];
};

export type MatchResult = { proposals: Proposal[]; unmatched: number[] };

const VAT = 0.05;
const near = (a: number, b: number) => Math.abs(a - b) <= 0.01 + Math.abs(b) * 0.001;
const round2 = (n: number) => Math.round(n * 100) / 100;

const STOP = new Set(["the", "and", "for", "of", "in", "to", "a", "an", "with", "on", "at", "per", "as", "by", "from", "x", "no"]);
function words(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** "WO3546", "WO-3546", "wo 3546" -> "3546"; plain numbers as written. */
export function referenceKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(?:wo|work\s*order|q|quotation|est(?:imate)?)?\s*[-#:]?\s*(\d{3,})/i);
  return match ? match[1] : null;
}

const referencesOf = (c: CandidateLine) =>
  new Set([referenceKey(c.workOrderNumber), referenceKey(c.quotationNumber)].filter((v): v is string => Boolean(v)));

export function matchInvoice(scanned: ScannedInvoice, candidates: CandidateLine[]): MatchResult {
  const invoiceRefs = new Set(scanned.references.map(referenceKey).filter((v): v is string => Boolean(v)));
  const open = candidates.filter((c) => c.remaining > 0.005);

  type Scored = { scannedIndex: number; candidate: CandidateLine; score: number; amount: number; reasons: string[]; evidence: boolean };
  const scored: Scored[] = [];
  scanned.lines.forEach((line, scannedIndex) => {
    const lineRef = referenceKey(line.reference);
    const scannedWords = words(line.description);
    for (const candidate of open) {
      const refs = referencesOf(candidate);
      const reasons: string[] = [];
      let score = 0;
      if (lineRef && refs.has(lineRef)) {
        score += 4;
        reasons.push(`the line names ${candidate.workOrderNumber ?? candidate.quotationNumber}`);
      } else if ([...invoiceRefs].some((r) => refs.has(r))) {
        score += 2;
        reasons.push(`the invoice names ${candidate.workOrderNumber ?? candidate.quotationNumber}`);
      } else if (lineRef) {
        continue; // The line names another work order.
      }

      let amount = candidate.remaining;
      let evidence = false;
      if (line.amount !== null && line.amount > 0) {
        evidence = true;
        if (near(line.amount, candidate.remaining)) {
          score += 3;
          reasons.push("the amount equals what is left on the line");
        } else if (near(line.amount, candidate.amount)) {
          score += 2.5;
          reasons.push("the amount equals the line's amount");
        } else if (near(line.amount, round2(candidate.remaining * (1 + VAT))) || near(line.amount, round2(candidate.amount * (1 + VAT)))) {
          score += 2.5;
          amount = Math.min(candidate.remaining, round2(line.amount / (1 + VAT)));
          reasons.push("the amount is the line's amount with 5 % VAT, so VAT is taken off");
        } else if (line.amount < candidate.remaining) {
          score += 0.5;
          amount = round2(line.amount);
          reasons.push("part of the line's amount (partial invoice)");
        } else {
          // More than the line has left: not this line, or not all of it.
          evidence = false;
          score -= 2;
          amount = candidate.remaining;
        }
      }

      const candidateWords = new Set([...words(candidate.name), ...words(candidate.description)]);
      const shared = [...scannedWords].filter((w) => candidateWords.has(w)).length;
      const union = new Set([...scannedWords, ...candidateWords]).size || 1;
      const similarity = shared / union;
      if (similarity > 0) {
        score += 4 * similarity;
        if (similarity >= 0.25) reasons.push("the descriptions match");
      }
      if (similarity >= 0.2) evidence = true;

      scored.push({ scannedIndex, candidate, score, amount: Math.min(round2(amount), candidate.remaining), reasons, evidence });
    }
  });

  /* Best first; each scanned line and each work-order line used once. */
  scored.sort((a, b) => b.score - a.score);
  const usedScanned = new Set<number>();
  const usedLines = new Set<string>();
  const proposals: Proposal[] = [];
  for (const s of scored) {
    if (s.score < 2 || !s.evidence || usedScanned.has(s.scannedIndex) || usedLines.has(s.candidate.lineId) || s.amount <= 0) continue;
    usedScanned.add(s.scannedIndex);
    usedLines.add(s.candidate.lineId);
    proposals.push({
      scannedIndex: s.scannedIndex,
      candidate: s.candidate,
      amount: s.amount,
      confidence: s.score >= 5.5 ? "high" : s.score >= 3.5 ? "medium" : "low",
      reasons: s.reasons,
    });
  }
  proposals.sort((a, b) => a.scannedIndex - b.scannedIndex);
  return { proposals, unmatched: scanned.lines.map((_, i) => i).filter((i) => !usedScanned.has(i)) };
}

/** Work order and quotation numbers the scan read, for finding the candidates. */
export function scannedReferences(scanned: ScannedInvoice): string[] {
  return [...new Set([...scanned.references, ...scanned.lines.map((l) => l.reference)].map(referenceKey).filter((v): v is string => Boolean(v)))];
}
