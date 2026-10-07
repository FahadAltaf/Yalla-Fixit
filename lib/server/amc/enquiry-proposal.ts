import type { SupabaseClient } from "@supabase/supabase-js";

import { servicesForProperty } from "@/components/dashboard/extensions/amc/amc-settings";
import { defaultFrequencyFor } from "@/components/dashboard/extensions/amc/amc-pricing";
import type { AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import { CLOSED_STAGES, siteVisitRequired } from "@/lib/amc/enquiries";
import { defaultPaymentPlan, legacyTermsForPlan, rateModelFor } from "@/lib/amc/proposal-rules";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { getCustomer, getProperty } from "@/lib/server/amc/business";
import { listScope } from "@/lib/server/amc/client-profile";
import { ContractError } from "@/lib/server/amc/contracts";
import { getEnquiry, linkEnquiryProposal } from "@/lib/server/amc/enquiries";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { rateCardInForce } from "@/lib/server/amc/rate-card";
import { readAmcSettings } from "@/lib/server/amc/settings";

/**
 * "Create proposal" from an enquiry (BRD 5.4, DEV-365): a draft in AMC
 * proposals with the client, the contact, the property and its type
 * filled, and its lines from the latest completed site visit (with the
 * units counted on site) or, without one, from the property's scope.
 * Priced on the rate card in force. It opens in the normal wizard; the
 * enquiry links to it and moves to Proposal Preparation.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

export interface ProposalFromEnquiry {
  submissionId: string;
  proposalNumber: string;
  /** Where the lines came from. */
  source: "site_visit" | "scope" | "none";
  warnings: string[];
}

export async function createProposalFromEnquiry(admin: Admin, enquiryId: string, actor: Actor, config: AmcConfig): Promise<ProposalFromEnquiry> {
  const enquiry = await getEnquiry(admin, enquiryId, config);
  if (enquiry.proposal) throw new ContractError(`Proposal ${enquiry.proposal.proposalNumber} was already started from this enquiry.`, 409);
  if (CLOSED_STAGES.includes(enquiry.stage)) throw new ContractError(`The enquiry is ${enquiry.stage}. Reopen it first.`, 409);
  if (!enquiry.property) throw new ContractError("Link the client's property to the enquiry first: the proposal is written for it.", 409);

  const warnings: string[] = [];
  const [customer, property, settings, card, visits] = await Promise.all([
    getCustomer(admin, enquiry.customer.id),
    getProperty(admin, enquiry.property.id),
    readAmcSettings(admin),
    rateCardInForce(admin),
    admin
      .from("amc_assessments")
      .select("id, recommended_service_ids, asset_counts, completed_at")
      .eq("enquiry_id", enquiryId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1),
  ]);
  const visit = ((visits.data ?? []) as Row[])[0] ?? null;

  const category = property.propertyCategory ?? enquiry.propertyCategory;
  if (siteVisitRequired(config, category) && !visit) {
    const message = `A completed site visit is required for ${category} properties before a proposal.`;
    if (config.proposals.siteVisitRule === "block") throw new ContractError(message, 409);
    warnings.push(message);
  }

  const propertyType = (property.unitType ?? enquiry.unitType ?? null) as Parameters<typeof rateModelFor>[0];
  const model = rateModelFor(propertyType, category);
  const offered = servicesForProperty(settings, model);

  /* The lines: the visit's recommendations and counts, else the property's scope. */
  let source: ProposalFromEnquiry["source"] = "none";
  const wanted = new Map<string, { units: number; frequency: number | null }>();
  if (visit) {
    source = "site_visit";
    const counts = (visit.asset_counts ?? {}) as Record<string, number>;
    for (const id of (visit.recommended_service_ids as string[] | null) ?? []) wanted.set(id, { units: Math.max(1, Math.trunc(Number(counts[id] ?? 1))), frequency: null });
  } else {
    const { items } = await listScope(admin, property.id);
    const active = items.filter((i) => i.active);
    if (active.length) source = "scope";
    for (const item of active) {
      const prev = wanted.get(item.serviceId);
      wanted.set(item.serviceId, { units: (prev?.units ?? 0) + item.quantity, frequency: item.frequencyPerYear ?? prev?.frequency ?? null });
    }
  }
  const dropped = [...wanted.keys()].filter((id) => !offered.some((s) => s.id === id));
  if (dropped.length) warnings.push(`Not offered on this property in AMC Settings, left out: ${dropped.join(", ")}.`);

  const rows = offered.map((s) => {
    const want = wanted.get(s.id);
    return {
      serviceId: s.id,
      included: !!want || s.includedFree === true,
      units: want?.units ?? 1,
      frequency: want?.frequency && want.frequency >= 1 ? Math.trunc(want.frequency) : defaultFrequencyFor(s),
      basePrice: null,
      free: s.includedFree === true && !want,
    };
  });
  const priced = priceSubmission({
    services: rows,
    discountPercent: 0,
    unitType: model,
    settings,
    rateCard: card ? { id: card.id, card: card.card } : null,
    day: todayInDubai(),
  });
  if (!priced.ok) throw new ContractError(priced.error, 409);
  warnings.push(...priced.rateProblems);

  const plan = defaultPaymentPlan(config.payments, priced.final_price);
  const contactPhone = enquiry.contactPhone ?? enquiry.contactWhatsapp ?? customer.phone ?? "";
  const insert: Row = {
    owner_id: actor.id,
    status: "draft",
    property: {
      propertyCategory: category ?? (model === "office" ? "commercial" : "residential"),
      unitType: model,
      propertyAddress: property.address ?? property.label,
      propertyDetail: property.label,
      ...(propertyType ? { propertyType } : {}),
    },
    customer: {
      customerName: customer.name,
      customerId: customer.customerRef ?? "",
      customerPhone: contactPhone,
      customerEmail: enquiry.contactEmail ?? customer.email ?? "",
      coordinationContacts: [
        { name: enquiry.contactName, phone: contactPhone, designation: property.occupancy === "tenant" ? "tenant" : "owner" },
        { name: "", phone: "", designation: "owner" },
      ],
      /* Dates are agreed in the wizard. */
      startDate: "",
      endDate: "",
      paymentTerms: legacyTermsForPlan(plan),
      proposalNumber: "",
    },
    document_options: {
      optionalSections: { supplyInstallPriceList: false, additionalFixedPriceServices: false },
      priceListRows: [],
      accountManagers: [
        { name: "", phone: "" },
        { name: "", phone: "" },
      ],
    },
    services: priced.services,
    discount_percent: priced.discount_percent,
    discount_amount: priced.discount_amount,
    final_price: priced.final_price,
    generated_documents: [],
    customer_id: customer.id,
    property_id: property.id,
    assessment_id: visit ? String(visit.id) : null,
    enquiry_id: enquiryId,
    property_type: propertyType,
    payment_plan: plan,
    rate_card_version_id: priced.rate_card_version_id,
    below_floor: priced.below_floor,
    version_started_at: new Date().toISOString(),
    version_started_by: actor.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("amc_submissions").insert(insert).select("id, proposal_number, customer").single<{ id: string; proposal_number: string; customer: Row }>();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      throw new ContractError("Creating a proposal from an enquiry needs the AMC database update 20261007140000.", 503);
    }
    throw new ContractError(error.message, 400);
  }
  /* Pin the JSON copy of the allocated number, as POST /api/amc-submissions does. */
  await admin.from("amc_submissions").update({ customer: { ...(data.customer ?? {}), proposalNumber: data.proposal_number } }).eq("id", data.id);
  if (visit) await admin.from("amc_assessments").update({ submission_id: data.id }).eq("id", String(visit.id)).is("submission_id", null);
  await linkEnquiryProposal(admin, enquiryId, data.id, actor, config);

  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: data.id,
    eventType: "created_from_enquiry",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { enquiryId, enquiryNumber: enquiry.enquiryNumber, source, assessmentId: visit?.id ?? null, rateCardVersionId: priced.rate_card_version_id, warnings },
  });
  return { submissionId: data.id, proposalNumber: data.proposal_number, source, warnings };
}
