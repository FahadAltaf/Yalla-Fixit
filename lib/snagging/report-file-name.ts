/** A safe file name for the inspection report, from the unit (SNG-140). */
export function reportFileName(unit: string | null | undefined, ext: "pdf" | "docx"): string {
  const base = (unit ?? "inspection").trim().replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
  return `${base || "inspection"}-snagging-report.${ext}`;
}
