/**
 * A snag's one ID (SNG-097).
 *
 * Every snag carries its own code from the moment the inspector records it
 * ("UNIT-1904-S004": the job's code and a running number). The app, the
 * portal and the report all show that code, so the team can refer to a snag
 * the same way everywhere. Where a code has to fit a dot (a plan pin, the
 * list's badge) the last part is shown: "S004" is the same code, shortened.
 */
export function shortSnagId(code: string | null | undefined): string | null {
  if (!code) return null;
  const tail = code.split("-").pop()?.trim();
  return tail || code;
}
