/**
 * The wording of a proposal's first page, the client's brochure: its
 * standard text, and what each piece is for (2026-09-28).
 *
 * Editable in AMC Settings (Proposal brochure) like the clauses, and kept
 * here with no imports so both the settings and the page can read it.
 * Each field is plain text: a list is one item per line, and each of the
 * six "why choose" points is its title, a blank line, then its text.
 */

export const AMC_BROCHURE_FIELDS = [
  {
    key: "heroTitle",
    label: "Banner title",
    hint: "The large white title on the red banner. One line per line.",
    value: "Total peace of mind.\nOne simple plan.",
  },
  {
    key: "heroTagline",
    label: "Banner tagline",
    hint: "The points under the banner title, one per line. They print on one row, separated by a bar.",
    value: "24/7 Emergency response\nUnlimited callouts\nDedicated AMC Account Manager\nCustomized AMC plans",
  },
  {
    key: "introTitle",
    label: "Introduction heading",
    hint: "The red heading under the banner.",
    value: "Your business shouldn't stop for maintenance issues.",
  },
  {
    key: "introBody",
    label: "Introduction text",
    hint: "The paragraph under the introduction heading.",
    value:
      "Our annual maintenance contracts take care of every maintenance need (AC, plumbing, electrical, and facility maintenance) giving you access to your dedicated account manager 24/7/365.",
  },
  {
    key: "whyTitle",
    label: "Why choose heading",
    hint: "The heading above the six points.",
    value: "Why choose Yalla Fix It's Annual Maintenance Contract?",
  },
  {
    key: "why1",
    label: "Why choose: point 1 (clock)",
    hint: "The title, a blank line, then the text.",
    value:
      "24/7/365 Support\n\nEmergency support for all your property's maintenance needs - call your dedicated account manager anytime, day or night.",
  },
  {
    key: "why2",
    label: "Why choose: point 2 (phone)",
    hint: "The title, a blank line, then the text.",
    value:
      "Unlimited Emergency Call-Outs\n\nFor AC malfunctions, plumbing problems, and electrical failures - plus unlimited non-emergency visits depending on your package.",
  },
  {
    key: "why3",
    label: "Why choose: point 3 (fast forward)",
    hint: "The title, a blank line, then the text.",
    value:
      "Fast Response Times\n\nEmergency call-outs attended within 120 minutes; non-emergency visits scheduled within 6 hours.",
  },
  {
    key: "why4",
    label: "Why choose: point 4 (shield)",
    hint: "The title, a blank line, then the text.",
    value:
      "Certified Technicians\n\nDubai municipality-approved, certified technicians equipped to handle every detail that keeps your business running smoothly.",
  },
  {
    key: "why5",
    label: "Why choose: point 5 (account manager)",
    hint: "The title, a blank line, then the text.",
    value:
      "Dedicated AMC Account Manager\n\nPersonalized support with a single point of contact for all your facility maintenance needs.",
  },
  {
    key: "why6",
    label: "Why choose: point 6 (discount)",
    hint: "The title, a blank line, then the text.",
    value:
      "Exclusive Discounts\n\nDiscounts on additional services not covered under your contract - grease trap cleaning, duct cleaning, kitchen hood cleaning, and more.",
  },
  {
    key: "planTitle",
    label: "Plan heading",
    hint: "Above the client's plan: who it is for, the fee, the coverage and the payment terms. The figures come from each proposal.",
    value: "Your plan",
  },
  {
    key: "buildTitle",
    label: "Build your own AMC: heading",
    hint: "Beside the puzzle picture, under the plan.",
    value: "Build your own AMC",
  },
  {
    key: "buildLead",
    label: "Build your own AMC: lead",
    hint: "The bold lines under the heading. One line per line.",
    value: "Flexible services. One simple plan.\nMix and match the modules your property needs",
  },
  {
    key: "buildNote",
    label: "Build your own AMC: note",
    hint: "The small italic note under the lead.",
    value:
      "Starting prices are based on basic services and minimum frequencies. Final price depends on the services and frequencies you select.",
  },
  {
    key: "servicesTitle",
    label: "Services heading",
    hint: "Above the services this client chose. The services and their frequencies come from each proposal.",
    value: "Services Covered",
  },
  {
    key: "servicesNote",
    label: "Services note",
    hint: "The small line under the services.",
    value:
      "The services and frequencies agreed for your property. Prices exclude 5% VAT.",
  },
  {
    key: "trusted",
    label: "Trusted line",
    hint: "The large line near the bottom. Words between ** print in bold red, for example **Dubai**.",
    value: "**Trusted** by **10,000+ properties** across **Dubai**",
  },
  {
    key: "cta",
    label: "Button",
    hint: "The red button under the trusted line.",
    value: "Book your free property assessment today",
  },
  {
    key: "contact",
    label: "Contact line",
    hint: "How to reach us, one item per line. They print on one row, with a phone, a globe and a WhatsApp icon in that order.",
    value: "800 7373328\nyallafixit.ae\nWhatsApp available 24/7",
  },
  {
    key: "address",
    label: "Address",
    hint: "The last line of the page.",
    value:
      "Gold & Diamond Park, Building 6, Al Quoz Industrial Area 3, Dubai, UAE · P.O. Box 392481",
  },
] as const;

export type AmcBrochureKey = (typeof AMC_BROCHURE_FIELDS)[number]["key"];

export const AMC_BROCHURE_KEYS = AMC_BROCHURE_FIELDS.map((field) => field.key) as AmcBrochureKey[];

/** The standard wording, keyed by field. */
export function getAmcBrochureDefaults(): Record<AmcBrochureKey, string> {
  return Object.fromEntries(
    AMC_BROCHURE_FIELDS.map((field) => [field.key, field.value]),
  ) as Record<AmcBrochureKey, string>;
}
