export interface QuotationEmailData {
  status: "sent" | "accepted" | "rejected";
  companyName?: string;
  quotationNumber?: string;
  quotationDate?: string;
  validUntil?: string;
  ownerName?: string;
  customerName?: string;

  serviceType?: string;

  notes?: string;
  rejectionReason?: string;
  logoUrl?: string; // swap with your actual hosted logo URL
}

const STATUS_CONFIG = {
  sent: {
    label: "QUOTATION SENT",
    badgeBg: "#dbeafe",
    badgeText: "#1d4ed8",
    badgeBorder: "#bfdbfe",
    greeting:
      "Please find your detailed quotation below. Kindly review and confirm at your earliest convenience.",
    banner: "",
  },
  accepted: {
    label: "APPROVED BY CUSTOMER",
    badgeBg: "#dcfce7",
    badgeText: "#15803d",
    badgeBorder: "#bbf7d0",
    greeting:
      "This quotation has been approved by the customer. Please review the details below and proceed to the next steps.",
    banner: `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:14px 16px;margin-bottom:20px;font-size:11px;color:#15803d;display:flex;align-items:center;gap:10px;">
        <div>
          <strong>Quotation Approved by Customer</strong><br />
          The customer has confirmed their approval of this quotation. Please coordinate the service and any required arrangements.
        </div>
      </div>`,
  },
  rejected: {
    label: "REJECTED BY CUSTOMER",
    badgeBg: "#fee2e2",
    badgeText: "#b91c1c",
    badgeBorder: "#fecaca",
    greeting:
      "The customer has rejected this quotation. Please review the feedback below and follow up with the customer if needed.",
    banner: "",
  },
  pending: {
    label: "PENDING REVIEW",
    icon: "&#8987;",
    badgeBg: "#fef3c7",
    badgeText: "#b45309",
    badgeBorder: "#fde68a",
    greeting:
      "Thank you for your quotation request. Our team is currently reviewing the details and will get back to you shortly.",
    banner: "",
  },
};

export function generateQuotationEmail(data: QuotationEmailData): string {
  const cfg = STATUS_CONFIG[data.status];
  const logoUrl = data.logoUrl ?? "https://portal.yallafixit.ae/yalla-fixit.png";

  const rejectionBanner =
    data.status === "rejected" && data.rejectionReason
      ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:11px;color:#991b1b;">
           <strong>Reason for Decline:</strong> ${data.rejectionReason}
         </div>`
      : "";



  const infoRow = (label: string, value: string, highlight = false) =>
    `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;min-width:150px;">${label}</td>
      <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:${highlight ? 700 : 500};color:${highlight ? "#0f172a" : "#1e293b"};text-align:right;">${value}</td>
    </tr>`;

  const quotationDetails = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:10px;">Quotation Details</div>
      <table style="width:100%;border-collapse:collapse;">
        ${infoRow("Quotation Number", data.quotationNumber ?? "—", true)}
        ${infoRow("Customer Name", data.customerName ?? "—", true)}
        ${infoRow("Quotation Date", data.quotationDate ?? "—")}

      </table>
    </div>`;





  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation ${data.quotationNumber ?? ""} — ${cfg.label}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="660" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);font-size:13px;color:#1a1a2e;">

          <!-- ── HEADER ── -->
          <tr>
            <td style="padding:32px 32px 0 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Logo + Company -->
                  <td style="vertical-align:top;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:top;">
                          <img src="${logoUrl}" alt="${data.companyName ?? "Yalla Fixit"}" width="70" height="70" style="display:block;object-fit:contain;" />
                        </td>
                        <td style="vertical-align:top;">
                          <div style="font-size:18px;font-weight:700;letter-spacing:-0.5px;">${data.companyName ?? "Yalla Fixit"}</div>
                          <div style="line-height:1.6;font-size:11px;color:#374151;">
                            Office 102, Building 6, Gold &amp; Diamond Park Dubai, UAE,<br />
                            <a href="https://www.yallafixit.ae" target="_blank" rel="noopener noreferrer" style="color:#1d4ed8;">https://www.yallafixit.ae</a>
                          </div>  
                        </td>
                      </tr>
                    </table>
                  </td>

                  <!-- Quotation Number + Badge -->
                  <td style="text-align:right;vertical-align:top;">
                    <div style="font-weight:700;font-size:14px;margin-bottom:3px;">Quotation</div>
                    <div style="font-weight:700;font-size:14px;color:#1e293b;margin-top:0px;">${data.quotationNumber ?? "—"}</div>
                    <div style="color:#64748b;font-size:11px;margin-top:2px;">${data.quotationDate ?? "—"}</div>
                   
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background:#e2e8f0;margin:24px 0 24px;"></div>
            </td>
          </tr>

          <!-- ── BODY ── -->
          <tr>
            <td style="padding:0 32px 28px;">

              <!-- Greeting -->
              <p style="font-size:12px;color:#374151;margin-bottom:20px;line-height:1.8;">
                Dear <strong>${data.ownerName ?? "Yalla Fixit Team"}</strong>,<br />
                ${cfg.greeting}
              </p>

              <!-- Status banners -->
              ${rejectionBanner}
              ${cfg.banner}

              <!-- Quotation Details Card -->
              ${quotationDetails}

           
            </td>
          </tr>

       

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}


// ── USAGE EXAMPLE ─────────────────────────────────────────────────────────────
//
// import { generateQuotationEmail } from "./quotationEmailTemplate";
//
// const html = generateQuotationEmail({
//   status: "accepted",
//   companyName: "Yalla Fixit",
//   quotationNumber: "QT-2025-0042",
//   quotationDate: "09 Mar 2025",
//   validUntil: "09 Apr 2025",
//   customerName: "Ahmed Al Mansouri",
//   customerEmail: "ahmed@example.com",
//   customerPhone: "+971 50 123 4567",
//   serviceAddress: "Villa 12, Jumeirah 3, Dubai",
//   serviceType: "AC Maintenance",
//   assignedTech: "Mohammed Hassan",
//   priority: "High",
//   grandTotal: 580.75,
//   notes: "Please ensure parking access is available.",
//   logoUrl: "https://yourdomain.com/yalla-fixit.png",
// });
//
// // Then pass `html` to your email sender (Nodemailer, Resend, SendGrid, etc.)
// await resend.emails.send({
//   from: "noreply@yallafixit.ae",
//   to: "ahmed@example.com",
//   subject: `Quotation QT-2025-0042 — Accepted`,
//   html,
// });