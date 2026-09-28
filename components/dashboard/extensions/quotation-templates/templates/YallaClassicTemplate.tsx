import { Children, type CSSProperties, type ReactNode } from "react";

import { QuotationData, calculateTotals } from "../quotation-templates";
import { inlineParts, parseScope, parseTerms } from "@/lib/snagging/quote-text";
import yallaFixit from "@/public/yalla-fixit.png";
import { formatCurrencyAED } from "@/utils/format-currency";

interface Props {
  data: QuotationData;
  hideDiscount?: boolean;
  /** When true, applies PDF-specific layout tweaks (e.g. header offset). Only set when rendering for PDF download. */
  forPDF?: boolean;
  type?: "normal" | "review";
  discountMode?: string;
  includeServiceItemImages?: boolean;
  rootQuotationNumber?: string;
  /**
   * How Scope of Work, Terms and Bank Details are set (see Section).
   * "plain", the original, unless the caller is a snagging quotation.
   */
  sectionStyle?: QuotationSectionStyle;
}

export function YallaClassicTemplate({
  data,
  hideDiscount = false,
  forPDF = false,
  type = "normal",
  discountMode,
  includeServiceItemImages = false,
  rootQuotationNumber,
  sectionStyle = "plain",
}: Props) {
  const calculated = calculateTotals(data);
  const subTotal = calculated.subTotal;
  const discount = data.lineItems.reduce((sum, item) => {
    const lineTotal = item.quantity * item.unitPrice;
    const lineDiscount =
      item.discountType === "Percent"
        ? ((item.discountAmount || 0) / 100) * lineTotal
        : item.discountAmount || 0;
    return sum + lineDiscount;
  }, 0);
  const totalAfterDiscount = subTotal - discount;
  const taxAmount = data.taxAmount || calculated.taxAmount;
  const grandTotal = data.grandTotal || calculated.grandTotal;
  const avgTax = calculated.avgTax;

  // "Discount Template By Total (Unit Price)": same as By Total, and the
  // Summary's Discount line always carries the effective percentage.
  //
  // The price column IS shown in this mode, but headed "Unit Price" rather
  // than "List Price", and it always renders the undiscounted per-unit rate
  // (item.unitPrice) -- the discount is applied once at the total, never to
  // this column.
  const priceColumnLabel = discountMode === "with-total-no-list" ? "Unit Price" : "List Price";
  const isByTotal =
    discountMode === "with-total" || discountMode === "with-total-no-list";
  const discountPct = subTotal > 0 ? (discount / subTotal) * 100 : 0;

  /*
    Scope and terms, read by the same rules as the Word file and the
    Settings preview (lib/snagging/quote-text): headings, sub-headings,
    real bullets, **bold**, and terms numbered for you (point 14).
  */
  /*
    A styled (snagging) quotation sets the Customer and Service Address
    blocks on the same light panels as its sections. The PDF padding is separate at the bottom, as everywhere else in
    this template: html2canvas draws text lower in a box than the browser.
  */
  const partyPanel: CSSProperties | undefined =
    sectionStyle === "plain"
      ? undefined
      : {
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: forPDF ? "8px 14px 18px" : "14px",
        };
  const partyTitle: CSSProperties = {};
  const termsLines = data.termsAndConditions ? parseTerms(data.termsAndConditions) : null;
  const scopeLines = data.scopeOfWork ? parseScope(data.scopeOfWork) : null;

  const isRevision =
    typeof data.quotationType === "string" &&
    data.quotationType.trim().toLowerCase() === "revision";
  const revisionCode =
    data.revisionType === "External"
      ? "CR"
      : data.revisionType === "Internal"
        ? "IR"
        : null;

  const revisionDisplayNumber =
    typeof data.revisionNumber === "number" ? String(data.revisionNumber) : null;
  const displayQuotationNumber =
    isRevision && revisionCode && rootQuotationNumber
      ? `${rootQuotationNumber}-${revisionCode}-${revisionDisplayNumber ? `${revisionDisplayNumber}` : ""}`
      : data.quotationNumber;
  const serviceItemImagesById = (data.serviceItemImages ?? []).reduce<Record<string, string[]>>(
    (acc, image) => {
      if (!acc[image.serviceItemId]) {
        acc[image.serviceItemId] = [];
      }
      acc[image.serviceItemId].push(image.supabaseUrl);
      return acc;
    },
    {},
  );

  return (
    <div
      id="quotation-pdf-root"
      style={{
        width: "794px",
        minHeight: "1123px",
        backgroundColor: "#ffffff",
        fontSize: "13px",
        color: "#1a1a2e",
        padding: "48px 20px",
        ...(forPDF ? { paddingTop: "0px", paddingBottom: '0px' } : type === "review" ? { paddingTop: "20px", paddingBottom: '20px' } : { paddingTop: "48px" }),

        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", justifyContent: "", alignItems: "flex-start", gap: "10px", marginBottom: "36px" }}>
          {/* <Image src={yallaFixit} width={100} height={100} alt="Yalla Fixit" style={{ width: "100px", height: "100px", objectFit: "contain", objectPosition: "left" }} /> */}
          <img src={yallaFixit.src} alt="Yalla Fixit" style={{ width: "70px", height: "70px", objectFit: "contain", objectPosition: "left" }} />
          <div style={forPDF ? { position: "relative", top: "-8px" } : undefined}>
            <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.5px" }}>
              {data.companyName}
            </div>
            <div style={{ lineHeight: 1.6, fontSize: "11px" }}>
              Office 102, Building 6, Gold & Diamond Park,
              Dubai,
              <><br /><a href="https://www.yallafixit.ae" target="_blank" rel="noopener noreferrer">https://www.yallafixit.ae</a></>

            </div>
          </div>

        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>

            Quotation
          </div>
          <div style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b", marginTop: "6px" }}>
            {displayQuotationNumber}
          </div>
          <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>{data.quotationDate}</div>
        </div>
      </div>
      {/* ── Divider ── */}
      {/* <div style={{ height: "2px", background: "linear-gradient(90deg, #1a56db 0%, #e2e8f0 100%)", marginBottom: "28px" }} /> */}

      {/* ── Customer + Service Address ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sectionStyle === "plain" ? "24px" : "16px", marginBottom: "28px" }}>
        <div style={partyPanel}>
          <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px", ...partyTitle }}>
            Customer
          </div>
          <div style={{ fontWeight: 600 }}>{data.customerCompanyName}</div>
          {data.customerContact && <div style={{ marginTop: "2px" }}>{data.customerContact}</div>}
          {data.customerPhone && <div style={{}}>{data.customerPhone}</div>}
          {data.customerEmail && <div style={{}}>{data.customerEmail}</div>}
          {data.customerId && (
            <div style={{ marginTop: "2px" }}>{data.customerId}</div>
          )}
        </div>

        {data.serviceAddress && (
          <div style={partyPanel}>
            <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px", ...partyTitle }}>
              Service Address
            </div>
            {/* {data.companyAddress && <div style={{ fontWeight: 600  }}>{data.companyAddress}</div>} */}
            <div style={{ color: "#475569", lineHeight: 1.6 }}>{data.serviceAddress}</div>
          </div>
        )}
      </div>

      {/* ── Line Items Table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <thead>
          <tr style={{ background: "black" }}>
            {(hideDiscount || isByTotal
              ? ["SR #", "Service & Part", "Qty", "Unit", priceColumnLabel, "Amount"]
              : ["SR #", "Service & Part", "Qty", "Unit", priceColumnLabel, "Discount", "Amount"]
            ).map((h, i) => (
              <th
                key={h}
                style={{
                  ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "10px 12px" }),
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "11px",
                  letterSpacing: "0.05em",
                  textAlign: i === 0 || i === 1 ? "left" : "right",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{}}>{h}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.lineItems.map((item, idx) => {
            const lineTotal = item.quantity * item.unitPrice;
            const lineDiscount =
              item.discountType === "Percent"
                ? ((item.discountAmount || 0) / 100) * lineTotal
                : item.discountAmount || 0;
            const lineItemAmount = lineTotal - lineDiscount;

            return (
              <tr
                key={idx}
                data-pdf-block
                style={{ background: idx % 2 === 0 ? "#f8fafc" : "#ffffff", borderBottom: "1px solid #e2e8f0" }}
              >
                <td style={{
                  fontSize: "11px", ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "left", verticalAlign: "top", color: "#64748b"
                }}>{idx + 1}</td>
                <td style={{
                  ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), verticalAlign: "top"
                }}>
                  <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "4px", fontSize: "11px" }}>
                    {item.description}
                  </div>
                  {item.details && (
                    <div style={{ color: "#64748b", fontSize: "11px", whiteSpace: 'pre-line' }}>
                      {item.details}
                    </div>
                  )}
                  {includeServiceItemImages && item.serviceItemId && serviceItemImagesById[item.serviceItemId]?.length > 0 && (
                    <div style={{ marginTop: "8px" }}>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                        {serviceItemImagesById[item.serviceItemId].map((url) => (
                          <img
                            key={url}
                            src={url}
                            alt={`${item.description} attachment`}
                            style={{
                              width: "100%",
                              height: "auto",
                              objectFit: "cover",
                              objectPosition: "top",
                              // borderRadius: "6px",
                              // border: "1px solid #e2e8f0",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </td>
                <td style={{
                  fontSize: "11px", ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", fontWeight: 500, verticalAlign: "top"
                }}>{item.quantity}</td>
                <td style={{
                  fontSize: "11px", ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", verticalAlign: "top", color: "#64748b"
                }}>{item.unit}</td>
                <td style={{
                  fontSize: "11px", width: "100px", ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap"
                }}>{formatCurrencyAED(item.unitPrice)}</td>
                {(discountMode === "with") && (
                  <td style={{
                    fontSize: "11px", width: "86px", ...(forPDF
                      ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                      : { padding: "12px" }), textAlign: "right", verticalAlign: "top", color: "#64748b"
                  }}>
                    {item?.discountType === 'Currency' ? `${formatCurrencyAED(item?.discountAmount)}` : `${item?.discountAmount?.toFixed(0)}%`}
                  </td>
                )}
                <td style={{
                  fontSize: "11px", width: "100px", ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", fontWeight: 600, verticalAlign: "top", color: "black", whiteSpace: "nowrap"
                }}>
                  {formatCurrencyAED(lineItemAmount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Totals ── */}
      <div id="totals-block" data-pdf-block style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
        <div style={{ minWidth: "260px" }}>
          {[
            { key: "subTotal", label: "Sub Total", value: subTotal, muted: false },
            { key: "discount", label: discountMode === 'with-total-no-list' ? `Discount (${discountPct.toFixed(0)}%)` : discountMode === 'with-total' ? data.totalDiscountType === 'Percentage' ? `Discount (${data.totalDiscount}%)` : `Discount` : "Discount", value: discount, muted: true },
            { key: "totalAfterDiscount", label: "Total After Discount", value: totalAfterDiscount, muted: true },
            {
              key: "taxAmount",
              label: data.taxAmount != null ? "Tax Amount (5%)" : `Tax Amount (${avgTax.toFixed(0)}%)`,
              value: taxAmount,
              muted: true,
            },
          ]
            .filter((row) => !(hideDiscount && (row.key === "discount" || row.key === "totalAfterDiscount")))
            .map(({ key, label, value, muted }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  ...(forPDF
                    ? { paddingBottom: "10px" }
                    : { padding: "5px 0px" }),
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <span style={{ color: muted ? "#64748b" : "#1e293b", fontSize: "11px" }}>{label}</span>
                <span style={{ color: muted ? "#64748b" : "#1e293b", fontSize: "11px", whiteSpace: "nowrap" }}>{formatCurrencyAED(typeof value === "number" ? value : value)}</span>
              </div>
            ))}
          <div style={{
            display: "flex", justifyContent: "space-between",
            ...(forPDF
              ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
              : { padding: "10px 12px" }),
            background: "black", borderRadius: "6px", marginTop: "8px"
          }}>
            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>Grand Total</span>
            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>{formatCurrencyAED(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/*
        ── Scope of work ──

        What the client is actually buying. On the team's own quotation this
        sits inside the priced line as a bulleted list under three headings;
        here it is its own block directly beneath the totals, which keeps the
        line table readable while printing the same words in the same order.

        Rendered only when the admin panel has something to print, so a
        template used elsewhere in the product is unaffected.
      */}
      {sectionStyle === "plain" ? (
        /* The original sections, exactly as every other quotation prints
           them. Only snagging quotations ask for a styled section. */
        <>
      {scopeLines && scopeLines.length > 0 ? (
        <div id="scope-block" style={{ paddingTop: "24px" }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: "11px",
              textTransform: "uppercase",
              marginBottom: "10px",
            }}
          >
            Scope of Work
          </div>
          {scopeLines.map((line, i) => (
            <div
              key={i}
              data-pdf-block
              style={{
                display: "flex",
                gap: "6px",
                fontSize: line.kind === "heading" ? "13px" : "11px",
                lineHeight: 1.5,
                fontWeight: line.kind === "heading" || line.kind === "subheading" ? 700 : 400,
                color: line.kind === "bullet" ? "#334155" : "#1e293b",
                marginTop:
                  i === 0
                    ? "0px"
                    : line.kind === "heading"
                      ? "12px"
                      : line.kind === "subheading"
                        ? "8px"
                        : "0px",
                marginBottom: line.kind === "heading" ? "5px" : "3px",
                paddingLeft: line.kind === "bullet" ? "12px" : "0px",
              }}
            >
              {/* Bullet in its own column, so a wrapped line lines up
                  under the text rather than under the bullet. */}
              {line.kind === "bullet" && <span style={{ fontWeight: 700 }}>•</span>}
              <span>
                {inlineParts(line.text).map((part, k) =>
                  part.bold ? <strong key={k}>{part.text}</strong> : <span key={k}>{part.text}</span>,
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Terms ── */}
      <div id="terms-block" style={{ paddingTop: "24px" }}>
        <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", marginBottom: "10px" }}>
          Terms and Conditions
        </div>
        {termsLines && termsLines.length > 0 && (
          termsLines.map((term) => (
            /* The number in its own column, so every wrapped line of a
               term lines up under its text. */
            <div key={term.number} data-pdf-block style={{ display: "flex", gap: "8px", marginBottom: "5px", fontSize: "11px", lineHeight: 1.5 }}>
              <span style={{ minWidth: "18px", fontWeight: 700 }}>{term.number}.</span>
              <span>
                {inlineParts(term.text).map((part, k) =>
                  part.bold ? <strong key={k}>{part.text}</strong> : <span key={k}>{part.text}</span>,
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* ── Bank Details & Support ── */}
      <div id="bank-details-block" data-pdf-block style={{ paddingTop: "24px" }}>
        <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase" }}>
          Bank Details & Support
        </div>
        <div style={{ fontSize: "11px", lineHeight: 1.7 }}>
          <p style={{ marginBottom: "10px" }}>For any questions contact <strong style={{ color: "#1e293b" }}>800-PERFECT</strong></p>
          <div style={{ display: "grid", gap: "4px" }}>
            <div><strong style={{ color: "#1e293b" }}>ACCOUNT NAME:</strong> YALLA FIX IT ONE PERSON COMPANY LLC</div>
            <div><strong style={{ color: "#1e293b" }}>BANK NAME:</strong> ABU DHABI COMMERCIAL BANK</div>
            <div><strong style={{ color: "#1e293b" }}>CID NUMBER:</strong> 11214542</div>
            <div><strong style={{ color: "#1e293b" }}>ACCOUNT NUMBER:</strong> 11214542920001</div>
            <div><strong style={{ color: "#1e293b" }}>IBAN NUMBER:</strong> AE360030011214542920001</div>
            <div><strong style={{ color: "#1e293b" }}>BRANCH:</strong> SHEIKH ZAYED ROAD</div>
            <div className="mb-2"><strong style={{ color: "#1e293b" }}>SWIFT CODE:</strong> ADCBAEAA</div>
          </div>
        </div>
      </div>
        </>
      ) : (
        /* Snagging quotations: each section boxed with its own header. */
        <>
      {scopeLines && scopeLines.length > 0 ? (
        <Section id="scope-block" title="Scope of Work" variant={sectionStyle} forPDF={forPDF}>
          {scopeLines.map((line, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: "6px",
                fontSize: line.kind === "heading" ? "13px" : "11px",
                lineHeight: 1.5,
                fontWeight: line.kind === "heading" || line.kind === "subheading" ? 700 : 400,
                /* Headings in the section's accent, so the scope reads in
                   parts rather than as one grey run. */
                color:
                  line.kind === "heading"
                    ? SECTION_STYLES[sectionStyle].heading
                    : line.kind === "bullet"
                      ? "#334155"
                      : "#1e293b",
                marginTop:
                  i === 0
                    ? "0px"
                    : line.kind === "heading"
                      ? "12px"
                      : line.kind === "subheading"
                        ? "8px"
                        : "0px",
                marginBottom: line.kind === "heading" ? "5px" : "3px",
                paddingLeft: line.kind === "bullet" ? "12px" : "0px",
              }}
            >
              {/* Bullet in its own column, so a wrapped line lines up
                  under the text rather than under the bullet. */}
              {line.kind === "bullet" && <span style={{ fontWeight: 700 }}>•</span>}
              <span>
                {inlineParts(line.text).map((part, k) =>
                  part.bold ? <strong key={k}>{part.text}</strong> : <span key={k}>{part.text}</span>,
                )}
              </span>
            </div>
          ))}
        </Section>
      ) : null}

      {/* ── Terms ── */}
      <Section id="terms-block" title="Terms and Conditions" variant={sectionStyle} forPDF={forPDF}>
        {(termsLines ?? []).map((term) => (
          /* The number in its own column, so every wrapped line of a
             term lines up under its text. */
          <div key={term.number} style={{ display: "flex", gap: "8px", marginBottom: "5px", fontSize: "11px", lineHeight: 1.5 }}>
            <span style={{ minWidth: "18px", fontWeight: 700 }}>{term.number}.</span>
            <span>
              {inlineParts(term.text).map((part, k) =>
                part.bold ? <strong key={k}>{part.text}</strong> : <span key={k}>{part.text}</span>,
              )}
            </span>
          </div>
        ))}
      </Section>

      {/* ── Bank Details & Support ── */}
      <Section id="bank-details-block" title="Bank Details & Support" variant={sectionStyle} forPDF={forPDF} keepTogether>
        {[
          <p key="support" style={{ fontSize: "11px", lineHeight: 1.7, marginBottom: "6px" }}>
            For any questions contact <strong style={{ color: "#1e293b" }}>800-PERFECT</strong>
          </p>,
          ...BANK_DETAILS.map(([label, value]) => (
            <div key={label} style={{ fontSize: "11px", lineHeight: 1.7 }}>
              <strong style={{ color: "#1e293b" }}>{label}:</strong> {value}
            </div>
          )),
        ]}
      </Section>
        </>
      )}

    </div>
  );
}

/*
  How the Scope of Work, Terms and Bank Details sections are set
  (2026-09-28). The client found them plain beside the black-headed line
  table, so snagging quotations box each one with a header of its own.
  Three looks were tried; "plain" is the original, and it stays the
  default for every other quotation that uses this template.
*/
export type QuotationSectionStyle = "plain" | "banded" | "tinted" | "outlined" | "panel";

const BRAND_RED = "#AA282A";

export const SECTION_STYLES: Record<
  QuotationSectionStyle,
  { box: CSSProperties; head: CSSProperties; title: CSSProperties; heading: string }
> = {
  plain: { box: {}, head: {}, title: {}, heading: "#1e293b" },
  /* A black header bar like the line table's, on a tinted, bordered panel. */
  banded: {
    box: { border: "1px solid #e2e8f0", borderRadius: "6px", background: "#f8fafc" },
    head: { background: "#000000", borderRadius: "5px 5px 0 0" },
    title: { color: "#ffffff" },
    heading: BRAND_RED,
  },
  /* A red title and a red rule down the left, on a tinted panel. */
  tinted: {
    box: { background: "#f8fafc", borderLeft: `3px solid ${BRAND_RED}`, borderRadius: "0 6px 6px 0" },
    head: {},
    title: { color: BRAND_RED, fontSize: "12px" },
    heading: BRAND_RED,
  },
  /*
    A light tinted panel with a thin border and a black title, the way the
    client's reference quotation sets its sections and its "Quotation by /
    to" blocks; the scope's own headings keep the brand red as the one
    accent. The snagging quotation's style.
  */
  panel: {
    box: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px" },
    head: {},
    title: { color: "#1a1a2e", textTransform: "none", fontSize: "13px", letterSpacing: "normal" },
    heading: BRAND_RED,
  },
  /*
    A bordered box with a light header strip: an area boundary, its title
    in the brand red. The snagging quotation's style: the black bar read
    too heavy for three sections of text.
  */
  outlined: {
    box: { border: "1px solid #cbd5e1", borderRadius: "6px", background: "#ffffff" },
    head: { background: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRadius: "5px 5px 0 0" },
    title: { color: BRAND_RED },
    heading: BRAND_RED,
  },
};

const BANK_DETAILS: [string, string][] = [
  ["ACCOUNT NAME", "YALLA FIX IT ONE PERSON COMPANY LLC"],
  ["BANK NAME", "ABU DHABI COMMERCIAL BANK"],
  ["CID NUMBER", "11214542"],
  ["ACCOUNT NUMBER", "11214542920001"],
  ["IBAN NUMBER", "AE360030011214542920001"],
  ["BRANCH", "SHEIKH ZAYED ROAD"],
  ["SWIFT CODE", "ADCBAEAA"],
];

/**
 * A boxed section: its header, then its lines.
 *
 * The header travels with the first line -- the two are one block to the
 * PDF paginator -- so a page never ends on a header with nothing under it.
 * Every other line is its own block, as before, so a long scope still
 * breaks between lines rather than through one. `keepTogether` makes the
 * whole section one block (the bank details, which are short).
 *
 * The header bar takes the PDF padding the line table's header row does
 * (none at the top, 15px at the bottom): html2canvas draws text lower in a
 * box than the browser, and a centred title would sit on the bar's edge.
 */
function Section({
  id,
  title,
  variant,
  forPDF,
  keepTogether = false,
  children,
}: {
  id: string;
  title: string;
  variant: QuotationSectionStyle;
  forPDF: boolean;
  keepTogether?: boolean;
  children: ReactNode;
}) {
  const style = SECTION_STYLES[variant];
  const items = Children.toArray(children);
  const barred = variant !== "tinted" && variant !== "panel";
  const headPadding = barred
    ? forPDF
      ? "0 14px 15px"
      : "10px 14px"
    : forPDF
      ? "8px 14px 6px"
      : "14px 14px 0";
  const block = (on: boolean) => (on ? { "data-pdf-block": "" } : {});

  return (
    <div id={id} style={{ marginTop: "24px" }}>
      <div {...block(keepTogether)} style={style.box}>
        <div {...block(!keepTogether)}>
          <div style={{ ...style.head, padding: headPadding }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                ...style.title,
              }}
            >
              {title}
            </div>
          </div>
          {items.length ? <div style={{ padding: "12px 14px 0" }}>{items[0]}</div> : null}
        </div>
        {items.slice(1).map((item, index) => (
          <div key={index} {...block(!keepTogether)} style={{ padding: "0 14px" }}>
            {item}
          </div>
        ))}
        <div style={{ height: "10px" }} />
      </div>
    </div>
  );
}
