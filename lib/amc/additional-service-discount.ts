/**
 * Discounts for AMC customers on work outside the contract.
 *
 * The brochure promises a discount on additional services (25% in the
 * shipped copy). Which services qualify, the rate, and whether it applies
 * per contract or per customer are BUSINESS DECISIONS REQUIRED, so nothing
 * applies it yet: the default configuration has no eligible services and
 * no rate, and no quotation flow calls this. When the decision is made,
 * quotations can call `additionalServicePrice` with the customer's
 * coverage and the approved configuration.
 */
import { filsToAed, percentToBasisPoints, toFils } from "./pricing";

export interface AdditionalServiceDiscountConfig {
  /** Percent off the standard price, e.g. 25. Null: no discount. */
  discountPercent: number | null;
  /** Service keys that qualify. Empty: none do. */
  eligibleServiceKeys: ReadonlyArray<string>;
}

export const DEFAULT_ADDITIONAL_SERVICE_DISCOUNT: AdditionalServiceDiscountConfig = {
  discountPercent: null,
  eligibleServiceKeys: [],
};

export interface AdditionalServicePrice {
  standardPrice: number;
  discountPercent: number;
  discountAmount: number;
  discountedPrice: number;
  eligible: boolean;
  reason: string;
}

/** Standard price less the AMC discount, rounded half up to the fil. */
export function discountedPrice(standardPrice: number, discountPercent: number): number {
  const fils = toFils(Math.max(0, standardPrice));
  const bp = percentToBasisPoints(Math.min(100, Math.max(0, discountPercent)));
  const discount = Math.floor((fils * bp + 5_000) / 10_000);
  return filsToAed(fils - discount);
}

export function additionalServicePrice({
  serviceKey,
  standardPrice,
  hasContractInForce,
  config = DEFAULT_ADDITIONAL_SERVICE_DISCOUNT,
}: {
  serviceKey: string;
  standardPrice: number;
  /** From the coverage engine: an AMC in force on the work date. */
  hasContractInForce: boolean;
  config?: AdditionalServiceDiscountConfig;
}): AdditionalServicePrice {
  const none = (reason: string): AdditionalServicePrice => ({
    standardPrice: filsToAed(toFils(standardPrice)),
    discountPercent: 0,
    discountAmount: 0,
    discountedPrice: filsToAed(toFils(standardPrice)),
    eligible: false,
    reason,
  });
  if (!hasContractInForce) return none("No AMC in force.");
  if (!config.discountPercent || config.discountPercent <= 0) {
    return none("No AMC discount is configured.");
  }
  if (!config.eligibleServiceKeys.includes(serviceKey)) {
    return none("This service is not eligible for the AMC discount.");
  }
  const after = discountedPrice(standardPrice, config.discountPercent);
  const standard = filsToAed(toFils(standardPrice));
  return {
    standardPrice: standard,
    discountPercent: config.discountPercent,
    discountAmount: filsToAed(toFils(standard) - toFils(after)),
    discountedPrice: after,
    eligible: true,
    reason: `AMC discount ${config.discountPercent}%.`,
  };
}
