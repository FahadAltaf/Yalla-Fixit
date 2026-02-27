import { QuotationData } from "./quotation-templates";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildQuotationEmailHtml({
  data,
  customMessage,
  approveUrl,
  rejectUrl,
  includeApprovalSection,
}: {
  data: QuotationData;
  customMessage: string;
  approveUrl: string;
  rejectUrl: string;
  includeApprovalSection: boolean;
}) {
  const {
    customerCompanyName,
    customerContact,
    quotationNumber,
    quotationDate,
    serviceAddress,
    grandTotal,
    taxAmount,
    lineItems,
  } = data;

  const formattedMessage = customMessage
    ? escapeHtml(customMessage)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("<br />")
    : "";

  const subtotal = lineItems.reduce(
    (sum, item) => sum + (item.unitPrice * item.quantity || 0),
    0
  );
  const discountAmount = lineItems.reduce(
    (sum, item) => sum + (item.discountAmount || 0),
    0
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Quotation ${quotationNumber}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f7fb; font-family:'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;">

  <div style="max-width:640px; margin:0 auto; padding:48px 16px;">

    <!-- Main Card -->
    <div style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 12px 30px rgba(0,0,0,0.08); border:1px solid #e8eef4;">

      <!-- Premium Header with Gradient -->
      <div style="background:linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding:28px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle">
              <div style="background:rgba(255,255,255,0.1); display:inline-block; padding:4px 12px; border-radius:30px; margin-bottom:8px;">
                <p style="margin:0; font-size:10px; font-weight:700; color:rgba(255,255,255,0.7); letter-spacing:2px; text-transform:uppercase;">📄 QUOTATION</p>
              </div>
              <h1 style="margin:0; font-size:28px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">${quotationNumber}</h1>
            </td>
            <td valign="middle" style="text-align:right;">
              <p style="margin:0 0 5px; font-size:11px; color:rgba(255,255,255,0.5); letter-spacing:0.5px;">Issue Date</p>
              <p style="margin:0; font-size:16px; font-weight:600; color:#ffffff;">${quotationDate}</p>
              ${data.validityDays ? `<p style="margin:5px 0 0; font-size:11px; color:rgba(255,255,255,0.5);">Valid for ${data.validityDays} days</p>` : ""}
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="padding:36px;">

        <!-- Personalized Greeting -->
        <div style="background:#f8faff; border-radius:12px; padding:20px; margin:0 0 28px; border-left:4px solid #1a1a1a;">
          <p style="margin:0; font-size:15px; line-height:1.6; color:#444444;">
          ${formattedMessage}
          </p>
        </div>

        <!-- Enhanced Info Cards -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
          <tr>
            <!-- Billed To -->
            <td valign="top" width="48%" style="background:#f9f9f9; border-radius:12px; padding:20px; border:1px solid #eaeef2;">
              <div style="margin-bottom:12px;">
                <span style="background:#1a1a1a; color:#ffffff; font-size:10px; font-weight:700; padding:4px 10px; border-radius:20px; letter-spacing:1px;">BILLED TO</span>
              </div>
              <p style="margin:0 0 4px; font-size:16px; font-weight:700; color:#111111;">${customerCompanyName}</p>
              <p style="margin:0; font-size:13px; color:#666666;">
                <span style="opacity:0.7;">👤</span> ${customerContact}
              </p>
            </td>
            <td width="4%"></td>
            <!-- Service Location -->
            <td valign="top" width="48%" style="background:#f9f9f9; border-radius:12px; padding:20px; border:1px solid #eaeef2;">
              <div style="margin-bottom:12px;">
                <span style="background:#1a1a1a; color:#ffffff; font-size:10px; font-weight:700; padding:4px 10px; border-radius:20px; letter-spacing:1px;">SERVICE LOCATION</span>
              </div>
              <p style="margin:0; font-size:15px; font-weight:600; color:#111111; line-height:1.5;">
                ${serviceAddress}
              </p>
            </td>
          </tr>
        </table>

        <!-- Price Summary Label -->
        <p style="margin:0 0 15px; font-size:12px; font-weight:800; color:#999999; letter-spacing:2px; text-transform:uppercase;">
          ⚡ PRICE SUMMARY
        </p>

        <!-- Enhanced Price Breakdown -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">

          <!-- Subtotal -->
          <tr>
            <td style="padding:12px 0; font-size:14px; color:#666666;">Subtotal</td>
            <td style="padding:12px 0; font-size:14px; color:#333333; font-weight:500; text-align:right;">${subtotal.toFixed(2)}</td>
          </tr>

          <!-- Discount (Remove if no discount) -->
          <tr>
            <td style="padding:12px 0; font-size:14px; color:#666666;">
              Discount
              <span style="display:inline-block; margin-left:10px; background:#e8f0fe; color:#1a5c9e; font-size:10px; font-weight:800; padding:3px 8px; border-radius:20px;">
                SAVED
              </span>
            </td>
            <td style="padding:12px 0; font-size:14px; color:#e53e3e; font-weight:500; text-align:right;">- ${discountAmount.toFixed(2)}</td>
          </tr>

          <!-- Tax -->
          <tr>
            <td style="padding:12px 0; font-size:14px; color:#666666;">VAT (5%)</td>
            <td style="padding:12px 0; font-size:14px; color:#333333; font-weight:500; text-align:right;">+ ${taxAmount?.toFixed(2) ?? 0}</td>
          </tr>

        </table>

        <!-- Grand Total Box with Gradient -->
        <div style="background:linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%); border-radius:12px; padding:20px 24px; margin:20px 0 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0; font-size:12px; font-weight:700; color:rgba(255,255,255,0.6); letter-spacing:1.5px; text-transform:uppercase;">Total Amount</p>
                <p style="margin:5px 0 0; font-size:14px; color:rgba(255,255,255,0.4);">Including all charges</p>
              </td>
              <td style="text-align:right;">
                <p style="margin:0; font-size:32px; font-weight:800; color:#ffffff; letter-spacing:-1px;">
                  ${grandTotal?.toFixed(2) ?? 0}
                </p>
              </td>
            </tr>
          </table>
        </div>

        <!-- CTA Buttons with Icons -->
        ${
          includeApprovalSection
            ? `
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:8px; width:50%;">
              <a href="${approveUrl}" style="display:block; padding:15px 0; border-radius:10px; background:#1a1a1a; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; text-align:center; letter-spacing:0.5px; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                ✅ &nbsp; APPROVE QUOTATION
              </a>
            </td>
            <td style="padding-left:8px; width:50%;">
                <a href="${rejectUrl}" style="display:block; padding:14px 0; border-radius:10px; background:#ffffff; color:#666666; font-size:14px; font-weight:600; text-decoration:none; text-align:center; letter-spacing:0.5px; border:2px solid #e0e5e9;">
                ❌ &nbsp; REJECT QUOTATION
              </a>
            </td>
          </tr>
        </table>
        `
            : ""
        }
      </div>

      <!-- Professional Footer -->
      <div style="padding:24px 36px; border-top:1px solid #eef2f5; background:#fafcfd;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0 0 5px; font-size:14px; font-weight:700; color:#1a1a1a;">YALLA FIXIT</p>
              <p style="margin:0; font-size:11px; color:#aaaaaa;">
                ⚡ Premium Maintenance Services
              </p>
            </td>
            <td style="text-align:right;">
              <p style="margin:0; font-size:11px; color:#888888; line-height:1.6;">
                Office 102, Building 6<br>
                Gold & Diamond Park, Dubai, UAE
              </p>
            </td>
          </tr>
        </table>
      </div>

    </div>

  </div>

</body>
</html>`;
}

