import { AMC_SERVICES } from "./amc-constants";
import { SCOPE_SECTIONS } from "./amc-contract-content";
import {
  formatDisplayDate,
  formatPaymentTermsLabel,
} from "./amc-pricing";
import type { AmcComputedData, AmcFormData } from "./amc-types";

export interface ProposalServiceRow {
  service: string;
  coverage: string;
  frequency: string;
}

export interface ProposalCommercialTerm {
  label: string;
  value: string;
}

const SERVICE_COVERAGE_FALLBACK: Record<string, string> = {
  helpdesk:
    "Round-the-clock technical support hotline for maintenance inquiries and coordination.",
  "ac-ppm":
    "Filter cleaning, coil inspection, drain line flush, outdoor unit check, and airflow verification.",
  "electrical-ppm":
    "Inspection of DB boards, switches, sockets, lighting, and safety devices.",
  "plumbing-ppm":
    "Leak checks, faucet & flush inspection, floor traps, and water heater connections.",
  "water-pump":
    "Pump operation check, pressure kit inspection, seals, and tank float switch review.",
  "roof-drain":
    "Roof and balcony drain cleaning, debris removal, and free-flow verification.",
  "water-tank":
    "Tank cleaning and disinfection with visual inspection of valves and pipework.",
  "duct-cleaning":
    "Air duct vacuum cleaning, diffuser wash, filter cleaning, and sanitization.",
  "coil-cleaning":
    "Deep evaporator coil cleaning, filter and drain pan cleaning, and performance check.",
  handyman:
    "Minor carpentry, adjustments, furniture assembly support, and light touch-up works within the handyman hours covered.",
  emergency:
    "Priority response for critical failures outside standard working hours and holidays.",
  "non-emergency":
    "Scheduled inspection and minor rectification visits within agreed working hours.",
};

function buildCoverage(serviceId: string, scope: string): string {
  const section = SCOPE_SECTIONS.find((item) => item.serviceId === serviceId);
  if (section?.bullets?.length) {
    return section.bullets.slice(0, 3).join(" ");
  }
  return SERVICE_COVERAGE_FALLBACK[serviceId] ?? scope;
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
        service: service.label.replace(/\s*\(.*?\)\s*/g, " ").trim(),
        coverage: buildCoverage(service.id, service.scope),
        frequency:
          frequencyByScope.get(service.scope) ??
          `${row.frequency} per year`,
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
      value: "Within 48 hours",
    },
    {
      label: "Emergency Response Time",
      value: "Within 120 minutes",
    },
  ];
}

export const PROPOSAL_IMPORTANT_NOTES = [
  "Spare parts, materials & major repairs are not included unless specified in writing.",
  "Any work outside the defined scope will be quoted separately for client approval.",
  "Access to the property must be provided as scheduled for PPM and call-out visits.",
  "Response times are subject to traffic conditions and site / community access.",
  "This proposal is valid for 30 days from the date of issue.",
] as const;

export function formatProposalFee(amount: number): string {
  return new Intl.NumberFormat("en-AE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getProposalValidityLabel(): string {
  return "1 Year";
}

export function getProposalStartLabel(data: AmcFormData): string {
  return formatDisplayDate(data.startDate) || "—";
}
