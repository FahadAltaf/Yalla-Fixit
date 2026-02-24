// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotationLineItem {
    description: string;
    details?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    taxRate: number; // percent e.g. 5
    /** Line total including tax (from API Line_Item_Amount). When set, template uses this instead of calculating. */
    lineAmount?: number;
    discountAmount: number;
    }

  export interface QuotationData {
    // Company (sender)
    companyName: string;
    companyAddress: string;
    companyWebsite?: string;
    companyPhone?: string;
    companyLogo?: string; // base64 or url
    customerId?: string;

    // Customer
    customerCompanyName: string;
    customerContact?: string;
    customerPhone?: string;
    customerEmail?: string;

    // Service
    serviceAddress?: string;

    // Quotation meta
    quotationNumber: string;
    quotationDate: string;
    validityDays?: number;

    // Line items
    lineItems: QuotationLineItem[];

    // Financials (from API when available; otherwise calculated)
    discountAmount?: number;
    /** Sub total from API (estimate.Sub_Total) */
    subTotal?: number;
    /** Tax amount from API (estimate.Tax_Amount) */
    taxAmount?: number;
    /** Grand total from API (estimate.Grand_Total) */
    grandTotal?: number;
    /** Terms and conditions text from API (Terms_And_Conditions.value) */
    termsAndConditions?: string;

    notes?: string;
  }
  
  export interface QuotationTemplate {
    id: string;
    name: string;
    description: string;
    tag: string;        // e.g. "Professional", "Modern", "Minimal"
    color: string;      // accent color for card preview
    previewBg: string;  // tailwind bg class for card
  }
  
  // ─── Available Templates ───────────────────────────────────────────────────
  
  export const QUOTATION_TEMPLATES: QuotationTemplate[] = [
    {
      id: "yalla-classic",
      name: "Classic Professional",
      description: "Clean corporate layout matching Yalla Fix It style — full T&C, itemized table, VAT breakdown.",
      tag: "Professional",
      color: "#1a56db",
      previewBg: "from-blue-50 to-slate-100",
    },
    {
      id: "modern-bold",
      name: "Modern Bold",
      description: "Dark header accent, bold typography, ideal for construction & technical services.",
      tag: "Modern",
      color: "#0f766e",
      previewBg: "from-teal-50 to-emerald-100",
    },
    {
      id: "minimal-clean",
      name: "Minimal Clean",
      description: "Ultra-clean single-column layout. Great for quick service quotes with minimal T&C.",
      tag: "Minimal",
      color: "#7c3aed",
      previewBg: "from-violet-50 to-purple-100",
    },
  ];
  

  
  // ─── Financial Calculations ───────────────────────────────────────────────
  
  export function calculateTotals(data: QuotationData) {
    const subTotal = data.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const discount = data.discountAmount ?? 0;
    const taxableAmount = subTotal - discount;
    // average tax rate across items (simplified)
    const avgTax =
      data.lineItems.reduce((sum, i) => sum + i.taxRate, 0) /
      (data.lineItems.length || 1);
    const taxAmount = (taxableAmount * avgTax) / 100;
    const grandTotal = taxableAmount + taxAmount;
    return { subTotal, discount, taxAmount, grandTotal, avgTax };
  }