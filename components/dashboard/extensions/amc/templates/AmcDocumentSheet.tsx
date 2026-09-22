"use client";

import { useMemo } from "react";

import { buildAmcDocumentModel } from "../amc-document-model";
import type { AmcComputedData } from "../amc-types";
import { AmcDocumentContinuous } from "./amc-doc/AmcDocumentLayouts";

/**
 * A proposal or contract on one continuous sheet, in the AMC document
 * design — the on-screen counterpart of the PDF and the Word file, built
 * from the same document model.
 */
export function AmcDocumentSheet({ data }: { data: AmcComputedData }) {
  const model = useMemo(() => buildAmcDocumentModel(data), [data]);
  return <AmcDocumentContinuous model={model} />;
}
