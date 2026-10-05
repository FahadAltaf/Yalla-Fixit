/*
  What the proposal, the client's brochure page, reads from a proposal:
  the services chosen, the property, the dates and the fee (2026-09-28).
  The old proposal template's commercial terms went with it.
*/
import { AMC_SERVICES } from "./amc-constants";
import { contractTermMonths } from "./amc-date-utils";
import {
  computeServiceRowPrice,
  formatDisplayDate,
} from "./amc-pricing";
import type { AmcComputedData, AmcFormData } from "./amc-types";

export interface ProposalServiceRow {
  serviceId: string;
  service: string;
  /* FR4.1 — "each with the units, frequency and price entered". */
  units: number;
  /** False leaves the UNITS cell empty; see FrequencyRow.hasUnits. */
  hasUnits: boolean;
  frequency: string;
  price: number;
}

export function buildProposalServiceRows(
  data: AmcFormData,
  frequencyRows: AmcComputedData["frequencyRows"],
  /* The services as AMC Settings holds them; the shipped list is the
     fallback for a caller that has no settings to hand. */
  services: ReadonlyArray<{ id: string; label: string; scope: string }> = AMC_SERVICES,
): ProposalServiceRow[] {
  const frequencyByScope = new Map(
    frequencyRows.map((row) => [row.scope, row.frequency]),
  );

  return data.serviceRows
    .filter((row) => row.included)
    .map((row) => {
      const service = services.find((item) => item.id === row.serviceId);
      if (!service) return null;

      const fromContract = frequencyRows.find(
        (item) => item.serviceId === service.id,
      );
      return {
        serviceId: service.id,
        service: service.label.replace(/\s*\(.*?\)\s*/g, " ").trim(),
        units: row.units,
        /*
          Taken from the contract's own row so the two documents agree
          about which services have a unit count at all. A caller with no
          matching row (an older snapshot) falls back to showing it,
          which is what the table did for everything before this.
        */
        hasUnits: fromContract ? fromContract.hasUnits : true,
        frequency:
          frequencyByScope.get(service.scope) ??
          `${row.frequency} per year`,
        price: computeServiceRowPrice(row),
      };
    })
    .filter((row): row is ProposalServiceRow => Boolean(row));
}

/*
  How long the proposal covers, from the one place that answers it.

  This counted calendar months itself, and so disagreed with the contract
  on the common case of a year written as 1 Jan to 31 Dec: this said 11
  months, the contract said one year. Both read contractTermMonths now.
*/
export function getProposalCoverageMonths(data: AmcFormData): number {
  if (!data.startDate || !data.endDate) return 12;
  return contractTermMonths(data.startDate, data.endDate);
}


export function getProposalPropertyLabel(data: AmcFormData): string {
  return [data.propertyDetail, data.propertyAddress]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" — ") || "—";
}

export function formatProposalFee(amount: number): string {
  return new Intl.NumberFormat("en-AE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getProposalStartLabel(data: AmcFormData): string {
  return formatDisplayDate(data.startDate) || "—";
}
