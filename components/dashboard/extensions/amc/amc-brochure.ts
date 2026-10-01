import { getAmcBrochureDefaults, type AmcBrochureKey } from "./amc-brochure-copy";
import { formatPaymentTermsLabel } from "./amc-pricing";
import { formatPhoneForDocument } from "./amc-phone";
import {
  buildProposalServiceRows,
  getProposalCoverageMonths,
  getProposalPropertyLabel,
  getProposalStartLabel,
} from "./amc-proposal-content";
import type { AmcComputedData } from "./amc-types";

/**
 * The first page of an AMC proposal: the client's brochure (2026-09-28).
 *
 * The design is the client's "customer version" of the AMC brochure --
 * photos, the red banner, why choose Yalla Fix It, then the plan and what
 * it covers. The brochure itself shows every plan ("Essential from AED 95
 * a month" and so on) and a general list of services. A proposal goes to
 * one client, so in its place this page shows only what that client chose:
 * their services, how often, and their fee. It is the whole proposal: no
 * pages follow it.
 *
 * Its wording is AMC Settings text (Proposal brochure), frozen with the
 * rest of a proposal's settings once it is sent (FR6.4).
 */

/* The six points' icons, by position: the wording is editable, the art is not. */
export const AMC_BROCHURE_ICONS = [
  "support",
  "callouts",
  "response",
  "certified",
  "manager",
  "discounts",
] as const;

export type AmcBrochureIcon = (typeof AMC_BROCHURE_ICONS)[number];

/** A piece of the trusted line: plain, or bold red. */
export type AmcBrochureRun = { text: string; strong: boolean };

/** The page's wording, read into the shape the page draws. */
export type AmcBrochureCopy = {
  heroTitle: string[];
  heroTagline: string[];
  introTitle: string;
  introBody: string;
  whyTitle: string;
  why: { icon: AmcBrochureIcon; title: string; body: string }[];
  planTitle: string;
  buildTitle: string;
  buildLead: string[];
  buildNote: string;
  servicesTitle: string;
  servicesNote: string;
  trusted: AmcBrochureRun[];
  /* The red button above the contact line. */
  cta: string;
  contact: string[];
  address: string;
};

/** What this client chose, for the brochure page, and its wording. */
export type AmcBrochure = {
  copy: AmcBrochureCopy;
  /* The proposal number and the date it was issued, for the header. */
  reference: string;
  issued: string;
  customerName: string;
  /*
    Everyone named on the proposal, with the number to reach them on.

    Both were names only, and the client's side was the FIRST coordination
    contact rather than all of them -- so a proposal naming a tenant and a
    representative printed one of them, and neither could be rung off the
    page.
  */
  contacts: { name: string; phone: string }[];
  accountManagers: { name: string; phone: string }[];
  propertyLabel: string;
  propertyType: string;
  coverageMonths: number;
  startLabel: string;
  /* Excluding VAT, as the proposal quotes it. */
  annualFee: number;
  monthlyFee: number;
  paymentTerms: string;
  /*
    What this client's plan covers, a row each. Units and frequency stay
    apart rather than joined into one line, because the page prints them
    as their own columns -- the contract's scope table, without a price.
  */
  services: { label: string; units: number; frequency: string }[];
};

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/* "**Trusted** by **Dubai**": the starred words bold and red. */
function runs(text: string): AmcBrochureRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), strong: true }
        : { text: part, strong: false },
    );
}

/* A point is its title, a blank line, then its text. */
function point(text: string): { title: string; body: string } {
  const [title = "", ...rest] = text.split(/\r?\n\s*\r?\n/);
  return { title: title.trim(), body: rest.join(" ").replace(/\s+/g, " ").trim() };
}

export function readAmcBrochureCopy(
  text: Partial<Record<AmcBrochureKey, string>> | undefined,
): AmcBrochureCopy {
  const value = { ...getAmcBrochureDefaults(), ...(text ?? {}) };
  const whyKeys = ["why1", "why2", "why3", "why4", "why5", "why6"] as const;
  return {
    heroTitle: lines(value.heroTitle),
    heroTagline: lines(value.heroTagline),
    introTitle: value.introTitle.trim(),
    introBody: value.introBody.trim(),
    whyTitle: value.whyTitle.trim(),
    why: whyKeys
      .map((key, index) => ({ icon: AMC_BROCHURE_ICONS[index], ...point(value[key]) }))
      // A point cleared in settings is left out rather than printed empty.
      .filter((item) => item.title || item.body),
    planTitle: value.planTitle.trim(),
    buildTitle: value.buildTitle.trim(),
    buildLead: lines(value.buildLead),
    buildNote: value.buildNote.trim(),
    servicesTitle: value.servicesTitle.trim(),
    servicesNote: value.servicesNote.trim(),
    trusted: runs(value.trusted.trim()),
    cta: value.cta.trim(),
    contact: lines(value.contact),
    address: value.address.trim(),
  };
}

export function buildAmcBrochure(data: AmcComputedData): AmcBrochure {
  const { formData, totals, frequencyRows } = data;
  return {
    copy: readAmcBrochureCopy(data.settings?.brochure),
    reference: formData.proposalNumber?.trim() ?? "",
    issued: data.proposalDate ?? "",
    customerName: formData.customerName || "—",
    contacts: (formData.coordinationContacts ?? [])
      .map((contact) => ({
        name: contact.name?.trim() ?? "",
        phone: formatPhoneForDocument(contact.phone ?? ""),
      }))
      .filter((contact) => contact.name || contact.phone),
    accountManagers: (formData.accountManagers ?? [])
      .map((manager) => ({
        name: manager.name?.trim() ?? "",
        phone: formatPhoneForDocument(manager.phone ?? ""),
      }))
      .filter((manager) => manager.name || manager.phone),
    propertyLabel: getProposalPropertyLabel(formData),
    propertyType: data.propertyTypeLabel,
    coverageMonths: getProposalCoverageMonths(formData),
    startLabel: getProposalStartLabel(formData),
    annualFee: totals.finalPrice,
    monthlyFee: totals.monthlyPrice,
    paymentTerms: formatPaymentTermsLabel(formData.paymentTerms),
    services: buildProposalServiceRows(formData, frequencyRows, data.settings.services).map((row) => ({
      label: row.service,
      units: row.units,
      frequency: row.frequency,
    })),
  };
}
