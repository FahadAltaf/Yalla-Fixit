import { AMC_SERVICES } from "./amc-constants";
import {
  computeServiceRowPrice,
  formatDisplayDate,
  formatPaymentTermsLabel,
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

export interface ProposalCommercialTerm {
  label: string;
  value: string;
}

export function buildProposalServiceRows(
  data: AmcFormData,
  frequencyRows: AmcComputedData["frequencyRows"],
): ProposalServiceRow[] {
  const frequencyByScope = new Map(
    frequencyRows.map((row) => [row.scope, row.frequency]),
  );

  return data.serviceRows
    .filter((row) => row.included)
    .map((row) => {
      const service = AMC_SERVICES.find((item) => item.id === row.serviceId);
      if (!service) return null;

      return {
        serviceId: service.id,
        service: service.label.replace(/\s*\(.*?\)\s*/g, " ").trim(),
        units: row.units,
        frequency:
          frequencyByScope.get(service.scope) ??
          `${row.frequency} per year`,
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

/* FR4.3: no package to name any more -- the AMC is described by the
   property category it covers. */
export function getProposalAmcType(data: AmcFormData): string {
  return data.propertyCategory === "commercial" ? "COMMERCIAL" : "RESIDENTIAL";
}

export function getProposalContactPerson(data: AmcFormData): string {
  const primary = data.coordinationContacts[0]?.name?.trim();
  return primary || data.customerName || "—";
}

export function getProposalPropertyLabel(data: AmcFormData): string {
  return [data.propertyDetail, data.propertyAddress]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" — ") || "—";
}

export function buildProposalCommercialTerms(
  data: AmcFormData,
  /* From AMC Settings (standard values). */
  commitments: { standardResponseTime: string; emergencyResponseTime: string },
): ProposalCommercialTerm[] {
  const emergencyIncluded = data.serviceRows.some(
    (row) => row.included && row.serviceId === "emergency",
  );
  const ppmRow = data.serviceRows.find(
    (row) => row.included && row.serviceId === "ac-ppm",
  );
  /*
    FR4.2: print the frequency the team entered. This previously fell
    through to the package's visit count, which is why a frequency edited
    to 5 still printed as 1 per year. If AC PPM is not on the proposal
    there is no visit count to state, so the row is dropped below.
  */
  const ppmVisits = ppmRow?.frequency;

  return [
    {
      label: "Payment Terms",
      value: formatPaymentTermsLabel(data.paymentTerms),
    },
    ...(ppmVisits
      ? [
          {
            label: "Preventive Maintenance Visits",
            value: `${ppmVisits} visit${ppmVisits === 1 ? "" : "s"} per year`,
          },
        ]
      : []),
    {
      label: "Emergency Call-outs",
      value: emergencyIncluded ? "Unlimited" : "As agreed",
    },
    {
      label: "Standard Response Time",
      value: commitments.standardResponseTime,
    },
    {
      label: "Emergency Response Time",
      value: commitments.emergencyResponseTime,
    },
  ];
}

export { PROPOSAL_IMPORTANT_NOTES } from "./amc-contract-content";

export function formatProposalFee(amount: number): string {
  return new Intl.NumberFormat("en-AE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}


export function getProposalStartLabel(data: AmcFormData): string {
  return formatDisplayDate(data.startDate) || "—";
}
