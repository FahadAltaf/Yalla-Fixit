import { calculateAmcTotals, computeServiceRowPrice } from "./amc-pricing";
import { getDefaultEndDate } from "./amc-constants";
import type {
  AmcDocumentType,
  AmcFormData,
  AmcSubmission,
  AmcSubmissionCustomer,
  AmcSubmissionPackage,
  AmcSubmissionProperty,
  AmcSubmissionServiceRow,
} from "./amc-types";

export function formDataToSubmissionPayload(
  data: AmcFormData,
  status: "draft" | "generated" = "draft",
  generatedDocuments?: AmcDocumentType[],
) {
  const services: AmcSubmissionServiceRow[] = data.serviceRows.map((row) => ({
    ...row,
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

  const pkg: AmcSubmissionPackage = {
    packageId: data.packageId,
    customMonthlyPrice: data.customMonthlyPrice,
    propertyCategory: data.propertyCategory,
  };

  return {
    status,
    property,
    customer,
    package: pkg,
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
    packageId: submission.package.packageId ?? "",
    customMonthlyPrice: submission.package.customMonthlyPrice,
    serviceRows: submission.services.map(
      ({ serviceId, included, units, frequency }) => ({
        serviceId,
        included,
        units,
        frequency,
      }),
    ),
    discountPercent: Number(submission.discount_percent) || 0,
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
