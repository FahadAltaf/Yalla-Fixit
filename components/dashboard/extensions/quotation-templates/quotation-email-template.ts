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
    serviceAddress,
    grandTotal,
    taxAmount,
    lineItems,
    customerEmail,
    customerPhone,
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
<body style="margin:0; padding:0; background-color:#f4f4f5;">

  <div style="max-width:640px; margin:0 auto; padding:32px 16px;">

    <!-- Shell -->
    <div style="background:#ffffff; border-radius:12px; border:1px solid #e5e7eb; overflow:hidden;">

      <!-- Header -->
       <div style="padding:32px 32px 0 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Logo + Company -->
                  <td style="vertical-align:top;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:top;">
                          <img src="https://portal.yallafixit.ae/yalla-fixit.png" alt="Yalla Fixit" width="70" height="70" style="display:block;object-fit:contain;" />
                        </td>
                        <td style="vertical-align:top;">
                          <div style="font-size:18px;font-weight:700;letter-spacing:-0.5px;">Yalla Fixit</div>
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
              <div style="height:1px;background:#e2e8f0;margin:24px 0 0;"></div>
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
              <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.16em; color:#3c4048; margin-bottom:4px;">
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
                    ${
                customerEmail
                  ? `<div style="font-size:12px; color:#4b5563; margin-bottom:1px;">${customerEmail}</div>`
                  : ""
              }
                    ${
                customerPhone
                  ? `<div style="font-size:12px; color:#4b5563; margin-bottom:1px;">${customerPhone}</div>`
                  : ""
              }
            </td>
            <td valign="top" style="padding:0; width:50%;">
              ${
                serviceAddress
                  ? `<div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.16em; color:#3c4048; margin-bottom:4px; text-align:left;">
                      Service Address
                    </div>
                  
                    <div style="font-size:13px; color:#4b5563;">
                      ${serviceAddress}
                    </div>`
                  : ""
              }
            </td>
          </tr>
        </table>

        <!-- Price Summary -->
        <div style="margin-top:4px; margin-bottom:8px; font-size:12px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase;  color:#3c4048">
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
      <div style="padding:14px 24px 18px; border-top:1px solid #e5e7eb; background:#f9fafb; font-size:11px; color:#3c4048;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:0; text-align:left; font-weight:600; color:#020617;">
              YALLA FIXIT
            </td>
            <td style="padding:0; text-align:right; line-height:1.5;">
              Office 102, Building 6<br/>
              Gold & Diamond Park Dubai, UAE
            </td>
          </tr>
        </table>
      </div>

    </div>

  </div>

</body>
</html>`;
}

