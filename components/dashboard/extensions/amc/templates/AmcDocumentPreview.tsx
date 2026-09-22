"use client";

import { FitToWidth } from "@/components/client-document/client-document-shell";

import type { AmcComputedData } from "../amc-types";
import { AmcDocumentSheet } from "./AmcDocumentSheet";

/**
 * The proposal or contract on the client link: one continuous document,
 * the same template as the Review & Submit preview, sized to the width of
 * the page's column (see FitToWidth).
 */
export function AmcDocumentPreview({ data }: { data: AmcComputedData }) {
  return (
    <FitToWidth>
      <AmcDocumentSheet data={data} />
    </FitToWidth>
  );
}
