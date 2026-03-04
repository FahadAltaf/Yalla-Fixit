import { formatCurrencyAED } from "@/utils/format-currency";
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
  discountMode,
}: {
  data: QuotationData;
  customMessage: string;
  approveUrl: string;
  rejectUrl: string;
  includeApprovalSection: boolean;
  discountMode: "with" | "without" | "with-total";
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
    companyAddress,
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
  const discountAmount = discountMode === "with-total" ? data.totalDiscountType === "Percentage" ? ((Number(data.totalDiscount) || 0) / 100) * subtotal : Number(data.totalDiscount) || 0 : lineItems.reduce((sum, item) => {
    const lineTotal = item.unitPrice * item.quantity;
    const lineDiscount =
      item.discountType === "Percent"
        ? ((item.discountAmount || 0) / 100) * lineTotal
        : item.discountAmount || 0;
    return sum + lineDiscount;
  }, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Quotation ${quotationNumber}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;">

  <div style="max-width:640px; margin:0 auto; padding:32px 16px;">

    <!-- Shell -->
    <div style="background:#ffffff; border-radius:12px; border:1px solid #e5e7eb; overflow:hidden;">

      <!-- Header -->
      <div style="padding:20px 24px; border-bottom:1px solid #e5e7eb; background:#0b0b0b; color:#ffffff;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td valign="top" style="padding:0; text-align:left;">
              <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; opacity:0.7; margin-bottom:4px;">
                Quotation
              </div>
              <div style="font-size:20px; font-weight:700; letter-spacing:-0.03em;">
                ${quotationNumber}
              </div>
            </td>
            <td valign="top" style="padding:0; text-align:right;">
              <div style="font-size:11px; opacity:0.7; margin-bottom:2px;">
                Date
              </div>
              <div style="font-size:13px; font-weight:600;">
                ${quotationDate}
              </div>
              ${
                data.validityDays
                  ? `<div style="font-size:11px; margin-top:4px; opacity:0.7;">Valid for ${data.validityDays} days</div>`
                  : ""
              }
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="padding:24px 24px 20px; color:#020617; font-size:13px; line-height:1.6;">

        <!-- Greeting / Message -->
        ${
          formattedMessage
            ? `<div style="margin-bottom:20px;">
             
                <div style="padding:12px 14px; border-radius:8px; border:1px solid #e5e7eb; background:#f9fafb; color:#111827; font-size:13px;">
                  ${formattedMessage}
                </div>
              </div>`
            : ""
        }

        <!-- Customer + Service Address -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:20px;">
          <tr>
            <td valign="top" style="padding:0; width:50%;">
              <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.16em; color:#6b7280; margin-bottom:4px;">
                Customer
              </div>
              <div style="font-size:13px; font-weight:600; color:#020617; margin-bottom:2px;">
                ${customerCompanyName}
              </div>
              ${
                customerContact
                  ? `<div style="font-size:12px; color:#4b5563; margin-bottom:1px;">${customerContact}</div>`
                  : ""
              }
            </td>
            <td valign="top" style="padding:0; width:50%;">
              ${
                serviceAddress
                  ? `<div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.16em; color:#6b7280; margin-bottom:4px; text-align:left;">
                      Service Address
                    </div>
                    ${ companyAddress ? `<div style="font-size:13px; font-weight:600; color:#020617; margin-bottom:2px;">
                        ${companyAddress}
                      </div>` : "" }
                    <div style="font-size:13px; color:#4b5563;">
                      ${serviceAddress}
                    </div>`
                  : ""
              }
            </td>
          </tr>
        </table>

        <!-- Price Summary -->
        <div style="margin-top:4px; margin-bottom:12px; font-size:11px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:#9ca3af;">
          Price summary
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:8px;">
          <tr>
            <td style="padding:6px 0; font-size:13px; color:#4b5563;">
              Subtotal
            </td>
            <td style="padding:6px 0; font-size:13px; color:#111827; text-align:right;">
           ${formatCurrencyAED(subtotal)}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0; font-size:13px; color:#4b5563;">
              ${discountMode === "with-total" ? data.totalDiscountType === "Percentage" ? `Discount (${data.totalDiscount}%)` : `Discount` : "Discount"}
            </td>
            <td style="padding:6px 0; font-size:13px; color:#b91c1c; text-align:right;">
              - ${formatCurrencyAED(discountAmount)}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0; font-size:13px; color:#4b5563;">
              VAT (5%)
            </td>
            <td style="padding:6px 0; font-size:13px; color:#111827; text-align:right;">
              + ${formatCurrencyAED(taxAmount ?? 0)}
            </td>
          </tr>
        </table>

        <!-- Grand Total -->
        <div style="margin-top:8px; margin-bottom:20px; padding:12px 14px; border-radius:8px; background:#020617; color:#f9fafb;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="font-size:12px; text-transform:uppercase; letter-spacing:0.16em; opacity:0.7;">
                Grand total
              </td>
              <td style="font-size:18px; font-weight:700; text-align:right;">
                ${formatCurrencyAED(grandTotal ?? 0)}
              </td>
            </tr>
          </table>
        </div>

        <!-- Actions -->
        ${
          includeApprovalSection
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:6px;">
                <tr>
                  <td style="padding-right:6px; width:50%;">
                    <a
                      href="${approveUrl}"
                      style="display:block; width:100%; text-align:center; padding:11px 0; border-radius:6px; background:#020617; color:#f9fafb; font-size:13px; font-weight:600; text-decoration:none; letter-spacing:0.06em; text-transform:uppercase;"
                    >
                      Approve
                    </a>
                  </td>
                  <td style="padding-left:6px; width:50%;">
                    <a
                      href="${rejectUrl}"
                      style="display:block; width:100%; text-align:center; padding:11px 0; border-radius:6px; background:#ffffff; color:#111827; font-size:13px; font-weight:500; text-decoration:none; letter-spacing:0.06em; text-transform:uppercase; border:1px solid #d1d5db;"
                    >
                      Reject
                    </a>
                  </td>
                </tr>
              </table>`
            : ""
        }

      </div>

      <!-- Footer -->
      <div style="padding:14px 24px 18px; border-top:1px solid #e5e7eb; background:#f9fafb; font-size:11px; color:#6b7280;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:0; text-align:left; font-weight:600; color:#020617;">
              YALLA FIXIT
            </td>
            <td style="padding:0; text-align:right; line-height:1.5;">
              Office 102, Building 6<br/>
              Gold & Diamond Park, Dubai, UAE
            </td>
          </tr>
        </table>
      </div>

    </div>

  </div>

</body>
</html>`;
}

