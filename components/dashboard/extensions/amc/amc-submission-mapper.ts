import { calculateAmcTotals, computeServiceRowPrice } from "./amc-pricing";
import { emptyPriceListRow, getDefaultEndDate } from "./amc-constants";
import type {
  AmcDocumentType,
  AmcFormData,
  AmcSubmission,
  AmcSubmissionCustomer,
  AmcSubmissionProperty,
  AmcSubmissionServiceRow,
} from "./amc-types";

/**
 * Builds the API payload for a submission.
 *
 * Status is not part of the payload at all. Under v2 it is owned by the
 * approval route (FR5.1-FR5.3): an autosave must never move a submission
 * through the workflow, and a client-settable status would let an owner
 * skip the approver entirely.
 */
export function formDataToSubmissionPayload(
  data: AmcFormData,
  generatedDocuments?: AmcDocumentType[],
) {
  const services: AmcSubmissionServiceRow[] = data.serviceRows.map((row) => ({
    ...row,
    basePrice: row.basePrice ?? null,
    price: computeServiceRowPrice(row),
  }));
  const totals = calculateAmcTotals(data);

  const property: AmcSubmissionProperty = {
    propertyCategory: data.propertyCategory,
    unitType: data.unitType,
    propertyAddress: data.propertyAddress,
    propertyDetail: data.propertyDetail,
  };

  const customer: AmcSubmissionCustomer = {
    customerName: data.customerName,
    customerId: data.customerId,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    coordinationContacts: data.coordinationContacts,
    startDate: data.startDate,
    endDate: data.endDate,
    paymentTerms: data.paymentTerms,
    proposalNumber: data.proposalNumber,
  };

  /* FR3.1 */
  const documentOptions = {
    optionalSections: data.optionalSections,
    priceListRows: data.priceListRows,
    accountManagers: data.accountManagers,
  };

  return {
    property,
    customer,
    document_options: documentOptions,
    services,
    discount_percent: totals.discountPercent,
    discount_amount: totals.discountAmount,
    final_price: totals.finalPrice,
    generated_documents: generatedDocuments,
  };
}

export function submissionToFormData(submission: AmcSubmission): AmcFormData {
  return {
    propertyCategory: submission.property.propertyCategory,
    unitType: submission.property.unitType,
    propertyAddress: submission.property.propertyAddress,
    propertyDetail: submission.property.propertyDetail,
    /* FR3.3: basePrice has to come back too, or reopening a submission
       silently blanks every price the team entered. */
    serviceRows: submission.services.map(
      ({ serviceId, included, units, frequency, basePrice }) => ({
        serviceId,
        included,
        units,
        frequency,
        basePrice: basePrice ?? undefined,
      }),
    ),
    discountPercent: Number(submission.discount_percent) || 0,
    /*
      FR3.3. Older submissions predate these fields, so each falls back to
      the same default a new proposal starts from -- reopening one must
      not crash on a missing key, and must not silently switch a section
      on either.
    */
    optionalSections: submission.document_options?.optionalSections ?? {
      supplyInstallPriceList: false,
      additionalFixedPriceServices: false,
    },
    priceListRows: submission.document_options?.priceListRows?.length
      ? submission.document_options.priceListRows
      : [emptyPriceListRow(), emptyPriceListRow(), emptyPriceListRow()],
    accountManagers: submission.document_options?.accountManagers ?? [
      { name: "", phone: "" },
      { name: "", phone: "" },
    ],
    customerName: submission.customer.customerName,
    customerId: submission.customer.customerId ?? "",
    customerPhone: submission.customer.customerPhone,
    customerEmail: submission.customer.customerEmail,
    coordinationContacts: submission.customer.coordinationContacts,
    startDate: submission.customer.startDate,
    endDate:
      submission.customer.endDate ??
      getDefaultEndDate(submission.customer.startDate),
    paymentTerms: submission.customer.paymentTerms,
    proposalNumber: submission.customer.proposalNumber,
    submissionId: submission.id,
  };
}
