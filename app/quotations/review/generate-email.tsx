export const generateQuotationEmail = ({
    quotationNumber,
    statusText,        // "accepted" or "rejected"
    greetingName,
    customerName,
    customerEmail,
    note,
}: {
    quotationNumber: string;
    statusText: string;
    greetingName: string;
    customerName: string;
    customerEmail: string;
    note: string;
}) => {

    const isAccepted = statusText?.toLowerCase() === "accepted";

    const statusColor = isAccepted ? "#059669" : "#dc2626";
    const badgeBg = isAccepted ? "#dcfce7" : "#fee2e2";
    const badgeColor = isAccepted ? "#15803d" : "#991b1b";
    const linkColor = isAccepted ? "#059669" : "#dc2626";
    const noteHeaderBg = isAccepted ? "#fef9c3" : "#fee2e2";
    const noteBorder = isAccepted ? "#fde68a" : "#fecaca";
    const noteBodyBg = isAccepted ? "#fffbeb" : "#fff5f5";
    const noteTitleClr = isAccepted ? "#92400e" : "#991b1b";
    const ctaText = isAccepted ? "View Quotation &rarr;" : "Revise Quotation &rarr;";
    const bodyMessage = isAccepted
        ? `Please proceed with scheduling and job assignment at your earliest convenience.`
        : `Please follow up with the customer to understand their concerns.`;


    const noteBlock = (note || customerName || customerEmail) ? `
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
        style="background:${noteBodyBg};border-radius:10px;border:1px solid ${noteBorder};margin:0 0 20px;overflow:hidden;">
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid ${noteBorder};background:${noteHeaderBg};">
            <span style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${noteTitleClr};">
              &#128172; Customer Note
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 16px;">
            ${note ? `<p style="margin:0 0 10px;font-size:13px;color:#374151;font-style:italic;line-height:1.6;">"${note}"</p>` : ""}
           
          </td>
        </tr>
      </table>` : "";

    const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Quotation ${quotationNumber} ${statusText} by customer</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
    </head>
    <body style="margin:0;padding:0;background-color:#eef0f4;">
  
      <!-- Preview text -->
      <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#eef0f4;">
        Customer ${customerName || ""} has ${statusText} Quotation ${quotationNumber} · Yalla Fixit · Dubai
      </div>
  
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
        style="background:#eef0f4;padding:32px 16px;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
       
  
                <!-- Header — Logo -->
                <tr>
                  <td style="padding:24px 28px 0;border-bottom:1px solid #f3f4f6;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
                      <td valign="middle">
                        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                          <td style="background:#0f172a;border-radius:10px;width:44px;height:44px;text-align:center;vertical-align:middle;">
                            <span style="font-size:20px;line-height:44px;display:block;">&#128295;</span>
                          </td>
                          <td style="padding-left:12px;vertical-align:middle;">
                            <div style="font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-0.5px;">Yalla Fixit</div>
                            <div style="font-size:11px;color:#9ca3af;margin-top:1px;">Maintenance &amp; Repairs &middot; Dubai</div>
                          </td>
                        </tr></table>
                      </td>
                      <td valign="middle" style="text-align:right;">
                        <div style="font-size:11px;color:#9ca3af;line-height:1.8;">
                          Office 102, Building 6<br/>
                          Gold &amp; Diamond Park, Dubai<br/>
                          <a href="https://www.yallafixit.ae"
                            style="color:${linkColor};text-decoration:none;font-weight:500;">
                            yallafixit.ae
                          </a>
                        </div>
                      </td>
                    </tr></table>
                    <div style="height:20px;"></div>
                  </td>
                </tr>
  
                <!-- Body -->
                <tr>
                  <td style="padding:24px 28px;font-size:14px;line-height:1.7;color:#374151;">
  
                    <p style="margin:0 0 16px;">
                      Hi <strong style="color:#0f172a;">${greetingName}</strong>,
                    </p>
                    <p style="margin:0 0 20px;">
                      The customer has
                      <strong style="color:${statusColor};">${statusText}</strong>
                      quotation
                      <strong style="color:#0f172a;font-family:'DM Mono',monospace;font-size:13px;">${quotationNumber}</strong>.
                      ${bodyMessage}
                    </p>
  
                    <!-- Quotation summary row -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                      style="background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;overflow:hidden;">
                      <tr>
                        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;background:#f1f5f9;">
                          <span style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">
                            Quotation Details
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <td style="padding:5px 0;font-size:13px;color:#6b7280;width:40%;">Quotation No.</td>
                              <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;font-family:'DM Mono',monospace;">
                                ${quotationNumber}
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:5px 0;font-size:13px;color:#6b7280;">Status</td>
                              <td style="padding:5px 0;">
                                <span style="background:${badgeBg};color:${badgeColor};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;letter-spacing:0.3px;">
                                  ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}
                                </span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
  
                    <!-- Note / Customer block -->
                    ${noteBlock}
  
                    <p style="margin:0;font-size:14px;color:#374151;">
                      Best regards,<br/>
                      <strong style="color:#0f172a;">The Yalla Fixit Team</strong>
                    </p>
  
                  </td>
                </tr>
  
                <!-- CTA Button -->
                <tr>
                  <td style="padding:0 28px 28px;">
                    <table cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="background:#0f172a;border-radius:8px;text-align:center;">
                          <a href="https://www.yallafixit.ae"
                            style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                            ${ctaText}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
  
              </table>
            </td></tr>
  
            <!-- Footer -->
            <tr>
              <td style="padding:20px 0 8px;text-align:center;">
                <p style="margin:0 0 6px;font-size:11px;color:#9ca3af;">
                  This is an automated notification from Yalla Fixit's quotation management system.
                </p>
                <p style="margin:0;font-size:11px;color:#9ca3af;">
                  &copy; ${new Date().getFullYear()} Yalla Fixit LLC &middot; Office 102, Building 6, Gold &amp; Diamond Park, Dubai, UAE
                </p>
                <p style="margin:8px 0 0;font-size:11px;">
                  <a href="https://www.yallafixit.ae" style="color:${linkColor};text-decoration:none;">yallafixit.ae</a>
                  &nbsp;&middot;&nbsp;
                  <a href="mailto:support@yallafixit.ae" style="color:${linkColor};text-decoration:none;">support@yallafixit.ae</a>
                </p>
              </td>
            </tr>
  
          </table>
        </td></tr>
      </table>
  
    </body>
  </html>`;

    return html;
};

// ─────────────────────────────────────────────
//  USAGE EXAMPLE
// ─────────────────────────────────────────────
// const emailHtml = generateQuotationEmail({
//   quotationNumber: "QT-2024-00847",
//   statusText:      "accepted",          // or "rejected"
//   greetingName:    "Sarah",
//   customerName:    "Ahmed Al-Rashidi",
//   customerEmail:   "ahmed@email.com",
//   note:            "Please schedule for Saturday morning.",
// });

