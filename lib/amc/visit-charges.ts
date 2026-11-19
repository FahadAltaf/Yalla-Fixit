import { z } from "zod";

import { AMC_VAT_RATE_BP, filsToAed, toFils } from "./pricing";

/*
  What a call out or additional work costs the client (18 Nov 2026).

  A call out's services are picked by the office, each priced from the rate
  card for the property and each charged or free (a covered call out's
  services are free by default). An additional work's lines are its
  quotation's. The charge is paid once: before the visit (it must be paid
  to start) or after it (a reason is required), chosen when the visit is
  started. Runs on the server and in the browser.
*/

export const CHARGE_STATUSES = ["due", "paid", "waived"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = { due: "To pay", paid: "Paid", waived: "Nothing to pay" };

export const PAYMENT_TIMINGS = ["before_visit", "after_visit"] as const;
export type PaymentTiming = (typeof PAYMENT_TIMINGS)[number];
export const PAYMENT_TIMING_LABELS: Record<PaymentTiming, string> = { before_visit: "Before the visit", after_visit: "After the visit" };

export const CHARGE_PAYMENT_MODES = ["cash", "transfer", "card", "link", "cheque"] as const;
export type ChargePaymentMode = (typeof CHARGE_PAYMENT_MODES)[number];
export const CHARGE_PAYMENT_MODE_LABELS: Record<ChargePaymentMode, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  card: "Card",
  link: "Payment link",
  cheque: "Cheque",
};

const text = (max: number) => z.string().trim().max(max);

/** One line: a service from the rate card (or a quotation line), its units and price excluding VAT, charged or free. */
export const chargeLineSchema = z
  .object({
    serviceId: text(100).nullable(),
    label: text(300).min(1, "Name the service"),
    /** What the rate is per (per unit, per visit ...), from the card. */
    unit: text(60).nullable(),
    units: z.number().positive("Give how many").max(10_000),
    /** AED excluding VAT, per unit. */
    unitPrice: z.number().min(0).max(10_000_000),
    /** The rate card's price for it, when it came from the card (a changed price is visible). */
    cardPrice: z.number().min(0).max(10_000_000).nullable().default(null),
    charged: z.boolean(),
  })
  .strict();
export type ChargeLine = z.infer<typeof chargeLineSchema>;

/** Charged lines only; VAT once on the subtotal, in fils. */
export function chargeTotals(lines: Array<Pick<ChargeLine, "units" | "unitPrice" | "charged">>) {
  const subtotal = lines.filter((l) => l.charged).reduce((sum, l) => sum + Math.round(l.units * toFils(l.unitPrice)), 0);
  const vat = Math.floor((subtotal * AMC_VAT_RATE_BP + 5_000) / 10_000);
  return { subtotal: filsToAed(subtotal), vatAmount: filsToAed(vat), total: filsToAed(subtotal + vat) };
}

export const saveServicesSchema = z.object({ lines: z.array(chargeLineSchema).max(40) }).strict();

export const recordChargePaymentSchema = z
  .object({
    amount: z.number().positive("Give the amount received").max(10_000_000),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date"),
    mode: z.enum(CHARGE_PAYMENT_MODES),
    reference: text(120).nullable(),
    note: text(500).nullable(),
  })
  .strict()
  .refine((p) => p.mode === "cash" || Boolean(p.reference?.trim()), { message: "Give the transfer, card or cheque reference", path: ["reference"] });

export const paymentTimingSchema = z
  .object({ timing: z.enum(PAYMENT_TIMINGS), reason: text(500).nullable() })
  .strict()
  .refine((p) => p.timing === "before_visit" || Boolean(p.reason?.trim()), { message: "Say why the client pays after the visit", path: ["reason"] });
export type PaymentTimingInput = z.infer<typeof paymentTimingSchema>;

/** A charge as the pages show it. */
export interface VisitCharge {
  id: string;
  contractId: string;
  kind: "call_out" | "additional_work";
  /** The call out's or additional work's id and number. */
  ownerId: string;
  ref: string | null;
  lines: ChargeLine[];
  subtotal: number;
  vatAmount: number;
  total: number;
  status: ChargeStatus;
  paymentTiming: PaymentTiming | null;
  paymentTimingReason: string | null;
  paidAmount: number | null;
  paidOn: string | null;
  paymentMode: ChargePaymentMode | null;
  paymentReference: string | null;
  paymentNote: string | null;
  recordedAt: string | null;
  createdAt: string;
  /** An additional work's quotation shown as its services before approval (19 Nov 2026): nothing is due yet. */
  draft?: boolean;
}

/** The material handling fee as a line of an additional work's charge (worked out from its materials, never picked). */
export const MATERIAL_FEE_SERVICE = "__material_fee";

/** A service the office can pick for this property, priced from the rate card in force. */
export interface PricedService {
  serviceId: string;
  label: string;
  unit: string | null;
  /** AED excluding VAT, per unit; null when the card has no rate for it on this property. */
  rate: number | null;
}

/** Whether there is something left to pay before the visit can start. */
export const chargeOpen = (c: Pick<VisitCharge, "status" | "total"> | null | undefined) => Boolean(c && c.status === "due" && c.total > 0);
