/*
  What the proposal, the client's brochure page, reads from a proposal:
  the services chosen, the property, the dates and the fee (2026-09-28).
  The old proposal template's commercial terms went with it.
*/
import { AMC_SERVICES } from "./amc-constants";
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
  /*
    The proposal lists exactly the services the contract's table lists:
    frequencyRows is already limited to services offered on this property
    by the settings in force, so a service switched off in Settings cannot
    print here while vanishing there. Matched by id; matching by scope text
    gave two services with the same scope each other's frequency.
  */
  const frequencyById = new Map(
    frequencyRows.map((row) => [row.serviceId, row.frequency]),
  );

  return data.serviceRows
    .filter((row) => row.included && frequencyById.has(row.serviceId))
    .map((row) => {
      const service = services.find((item) => item.id === row.serviceId);
      if (!service) return null;

      return {
        serviceId: service.id,
        service: service.label.replace(/\s*\(.*?\)\s*/g, " ").trim(),
        units: row.units,
        frequency: frequencyById.get(row.serviceId) ?? `${row.frequency} per year`,
        price: computeServiceRowPrice(row),
      };
    })
    .filter((row): row is ProposalServiceRow => Boolean(row));
}

export function getProposalCoverageMonths(data: AmcFormData): number {
  if (!data.startDate || !data.endDate) return 12;
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 12;

  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    (end.getDate() >= start.getDate() ? 0 : -1);

  return Math.max(1, months || 12);
}


export function getProposalPropertyLabel(data: AmcFormData): string {
  return [data.propertyDetail, data.propertyAddress]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" — ") || "—";
}

/*
  Whole dirhams print as they always did (3,500); a fee with fils keeps
  them (3,500.50) instead of rounding to 3,501, which disagreed with the
  contract's figure for the same proposal.
*/
export function formatProposalFee(amount: number): string {
  const hasFils = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-AE", {
    minimumFractionDigits: hasFils ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function getProposalStartLabel(data: AmcFormData): string {
  return formatDisplayDate(data.startDate) || "—";
}
