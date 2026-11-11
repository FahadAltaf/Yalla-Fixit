/**
 * Finds placeholder text ("XXX", "05x xxx xx", "xxx@tphgroup.me") in what
 * an outgoing AMC document will actually print.
 *
 * FR4.4: no document ever prints XXX. The old check ran /XXX/ over the
 * whole settings JSON: case-sensitive, blind to the proposal's own fields
 * (contacts, account managers, price list), and it refused a send over
 * text in a clause that was switched off and would never print. This one
 * looks only at printed text and says where the placeholder is.
 *
 * No imports: usable on the server and in the browser.
 */

/** Three or more x's in a row, any case. */
const PLACEHOLDER = /x{3,}/i;

export interface PlaceholderHit {
  /** Where, in words a coordinator can act on ("AMC Settings > Provider > Contact number"). */
  location: string;
  /** A short piece of the text around it. */
  excerpt: string;
}

export interface PrintedText {
  location: string;
  text: string | null | undefined;
}

export function findPlaceholders(texts: ReadonlyArray<PrintedText>): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  for (const { location, text } of texts) {
    if (typeof text !== "string" || !text) continue;
    const match = PLACEHOLDER.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - 20);
    const end = Math.min(text.length, match.index + match[0].length + 20);
    hits.push({
      location,
      excerpt: `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${
        end < text.length ? "…" : ""
      }`,
    });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* What an AMC document prints                                         */
/* ------------------------------------------------------------------ */

interface SettingsLike {
  provider?: Record<string, unknown>;
  clauseList?: ReadonlyArray<{
    id?: string;
    title?: string;
    body?: string;
    role?: string;
    enabled?: boolean;
  }>;
  services?: ReadonlyArray<{ id: string; label?: string; scope?: string }>;
  serviceScopes?: Record<string, string>;
  brochure?: Record<string, unknown>;
}

interface ProposalLike {
  property?: { propertyAddress?: string; propertyDetail?: string } | null;
  customer?: {
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    coordinationContacts?: ReadonlyArray<{ name?: string; phone?: string }>;
  } | null;
  services?: ReadonlyArray<{ serviceId: string; included?: boolean }> | null;
  document_options?: {
    optionalSections?: {
      supplyInstallPriceList?: boolean;
      additionalFixedPriceServices?: boolean;
    };
    priceListRows?: ReadonlyArray<Record<string, unknown>>;
    accountManagers?: ReadonlyArray<{ name?: string; phone?: string }>;
  } | null;
}

/* Clauses that print only when their optional section is switched on. */
const OPTIONAL_CLAUSE_ROLES: Record<string, "supplyInstallPriceList" | "additionalFixedPriceServices"> = {
  priceListIntro: "supplyInstallPriceList",
  handymanRates: "additionalFixedPriceServices",
};

/**
 * Everything the proposal or contract for this submission will print,
 * labelled. Hidden content is left out: switched-off clauses, optional
 * sections that are off, and services that are not ticked.
 */
export function printedAmcText(
  settings: SettingsLike,
  proposal: ProposalLike,
  document: "proposal" | "contract",
): PrintedText[] {
  const out: PrintedText[] = [];
  const options = proposal.document_options ?? {};
  const sections = options.optionalSections ?? {};
  const ticked = new Set(
    (proposal.services ?? []).filter((row) => row.included).map((row) => row.serviceId),
  );

  for (const [key, value] of Object.entries(settings.provider ?? {})) {
    if (typeof value === "string") {
      out.push({ location: `AMC Settings > Provider > ${key}`, text: value });
    } else if (Array.isArray(value)) {
      value.forEach((item, i) =>
        out.push({ location: `AMC Settings > Provider > ${key} ${i + 1}`, text: String(item) }),
      );
    }
  }

  if (document === "contract") {
    for (const clause of settings.clauseList ?? []) {
      if (clause.enabled === false) continue;
      const needs = clause.role ? OPTIONAL_CLAUSE_ROLES[clause.role] : undefined;
      if (needs && !sections[needs]) continue;
      const name = clause.title || clause.role || clause.id || "clause";
      out.push({ location: `AMC Settings > Clauses > ${name}`, text: clause.title });
      out.push({ location: `AMC Settings > Clauses > ${name}`, text: clause.body });
    }
  }

  for (const service of settings.services ?? []) {
    if (!ticked.has(service.id)) continue;
    out.push({ location: `AMC Settings > Services > ${service.label ?? service.id}`, text: service.label });
    out.push({ location: `AMC Settings > Services > ${service.label ?? service.id}`, text: service.scope });
    if (document === "contract") {
      out.push({
        location: `AMC Settings > Service scopes > ${service.label ?? service.id}`,
        text: settings.serviceScopes?.[service.id],
      });
    }
  }

  if (document === "proposal") {
    for (const [key, value] of Object.entries(settings.brochure ?? {})) {
      if (typeof value === "string") {
        out.push({ location: `AMC Settings > Proposal wording > ${key}`, text: value });
      }
    }
  }

  const property = proposal.property ?? {};
  out.push({ location: "Proposal > Property address", text: property.propertyAddress });
  out.push({ location: "Proposal > Property detail", text: property.propertyDetail });

  const customer = proposal.customer ?? {};
  out.push({ location: "Proposal > Customer name", text: customer.customerName });
  out.push({ location: "Proposal > Customer phone", text: customer.customerPhone });
  out.push({ location: "Proposal > Customer email", text: customer.customerEmail });
  (customer.coordinationContacts ?? []).forEach((contact, i) => {
    out.push({ location: `Proposal > Coordination contact ${i + 1} name`, text: contact.name });
    out.push({ location: `Proposal > Coordination contact ${i + 1} phone`, text: contact.phone });
  });

  (options.accountManagers ?? []).forEach((manager, i) => {
    out.push({ location: `Proposal > Account manager ${i + 1} name`, text: manager.name });
    out.push({ location: `Proposal > Account manager ${i + 1} phone`, text: manager.phone });
  });

  if (document === "contract" && sections.supplyInstallPriceList) {
    (options.priceListRows ?? []).forEach((row, i) => {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "string") {
          out.push({ location: `Proposal > Price list row ${i + 1} ${key}`, text: value });
        }
      }
    });
  }

  return out;
}

/** One sentence for an error message: where to fix it. */
export function describePlaceholders(hits: ReadonlyArray<PlaceholderHit>, max = 3): string {
  const listed = hits.slice(0, max).map((hit) => `${hit.location} ("${hit.excerpt}")`);
  const more = hits.length > max ? ` and ${hits.length - max} more` : "";
  return `${listed.join("; ")}${more}`;
}
