/**
 * The client's signature, as the system records it today, and nothing
 * more.
 *
 * What is stored when a client signs (app/api/amc/[token]/route.ts):
 *   signed_by_name   the full name the client typed (required, trimmed)
 *   signed_at        server time of the signature
 *   status           'signed' (final)
 * plus, from the earlier proposal answer, client_decision ('approved'),
 * client_decided_at and client_decided_by_name, and the contract wording
 * frozen at send time in contract_settings_snapshot. No IP address, device,
 * drawn signature or document hash is captured.
 *
 * BUSINESS DECISION REQUIRED: whether the typed name and time should be
 * printed in the contract's signature block. Today the signed contract
 * prints blank signature lines (amc-document-model.ts, "signatures"
 * clause). When the decision is made, the block can take
 * `recordedSignature(row)` and print `signatureCaption(...)` under the
 * client's line; nothing else needs to change.
 */

export interface RecordedSignature {
  name: string;
  signedAt: string;
}

/** The recorded signature on a submission row, or null if not signed. */
export function recordedSignature(row: {
  status?: string | null;
  signed_by_name?: string | null;
  signed_at?: string | null;
}): RecordedSignature | null {
  if (row.status !== "signed") return null;
  const name = row.signed_by_name?.trim();
  if (!name || !row.signed_at) return null;
  return { name, signedAt: row.signed_at };
}

/** How a recorded signature would read under the client's signature line. */
export function signatureCaption(signature: RecordedSignature): string {
  const when = new Date(signature.signedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  });
  return `Signed online by ${signature.name} (typed name) on ${when}, UAE time`;
}
