// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotationLineItem {
    description: string;
    details?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    taxRate: number; // percent e.g. 5
  }
  
  export interface QuotationData {
    // Company (sender)
    companyName: string;
    companyAddress: string;
    companyWebsite?: string;
    companyPhone?: string;
    companyLogo?: string; // base64 or url
  
    // Customer
    customerName: string;
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
  
    // Financials (auto-calculated if not overridden)
    discountAmount?: number;
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
  
  // ─── Default/Sample Data ──────────────────────────────────────────────────
  
  export const DEFAULT_QUOTATION_DATA: QuotationData = {
    companyName: "Yalla Fix It",
    companyAddress: "Office 102, Building 6, Gold & Diamond Park, Dubai",
    companyWebsite: "https://www.yallafixit.ae/",
    companyPhone: "800-PERFECT",
  
    customerName: "PADDLE LAND SPORTS AND AMUSEMENT PARK TRACKS LLC",
    customerContact: "HUSSAIN BADRI",
    customerPhone: "0501723525",
    customerEmail: "hussain.badri@padelae.com",
  
    serviceAddress: "MAG Warehouse 701 & 702 Al Quoz Industrial Area 2, Dubai, United Arab Emirates",
  
    quotationNumber: "17087 IR 01",
    quotationDate: new Date().toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
    validityDays: 7,
  
    lineItems: [
      {
        description: "Replacement of Table Underneath Support",
        details:
          "Replacement of existing underneath table support (50x50 cm) due to insufficient thickness. Upgraded to 12mm thick MDF. Includes dismantling, removal, cutting, installation, and final inspection.",
        quantity: 4,
        unit: "NOs",
        unitPrice: 175,
        taxRate: 5,
      },
    ],
  
    discountAmount: 665,
    notes: "Payment: 100% advance. Valid for 7 days from date of issuance.",
  };
  
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