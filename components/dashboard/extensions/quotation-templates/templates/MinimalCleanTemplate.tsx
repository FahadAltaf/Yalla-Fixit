import React from "react";
import { QuotationData, calculateTotals } from "../quotation-templates";

interface Props {
  data: QuotationData;
}

export function MinimalCleanTemplate({ data }: Props) {
  const { subTotal, discount, taxAmount, grandTotal, avgTax } = calculateTotals(data);

  return (
    <div
      id="quotation-pdf-root"
      style={{
        width: "794px",
        minHeight: "1123px",
        backgroundColor: "#fafafa",
        // fontFamily: "'Helvetica Neue', Helvetica, sans-serif",
        fontSize: "13px",
        color: "#18181b",
        padding: "60px 64px",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* ── Top accent line ── */}
      <div style={{ height: "3px", background: "#7c3aed", marginBottom: "40px", borderRadius: "2px" }} />

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px" }}>
        <div>
          <div style={{ fontSize: "26px", fontWeight: 900, color: "#18181b", letterSpacing: "-1px" }}>
            {data.companyName}
          </div>
          <div style={{ color: "#71717a", marginTop: "6px", fontSize: "12px", lineHeight: 1.7, maxWidth: "280px" }}>
            {data.companyAddress}
            {data.companyWebsite && <><br /><span style={{ color: "#7c3aed" }}>{data.companyWebsite}</span></>}
          </div>
        </div>
        <div>
          <div style={{
            fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.15em",
            color: "#7c3aed", fontWeight: 700, marginBottom: "6px", textAlign: "right"
          }}>
            Quotation
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#18181b", textAlign: "right" }}>
            #{data.quotationNumber}
          </div>
          <div style={{ color: "#71717a", fontSize: "12px", marginTop: "4px", textAlign: "right" }}>
            Issued: {data.quotationDate}
          </div>
          {data.validityDays && (
            <div style={{
              marginTop: "8px", background: "#7c3aed", color: "#ffffff",
              fontSize: "10px", fontWeight: 600, padding: "3px 10px",
              borderRadius: "100px", display: "inline-block", float: "right"
            }}>
              Valid {data.validityDays} days
            </div>
          )}
        </div>
      </div>

      {/* ── Recipient block ── */}
      <div style={{ marginBottom: "36px" }}>
        <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#a1a1aa", marginBottom: "8px" }}>
          Prepared for
        </div>
        <div style={{ fontWeight: 700, fontSize: "15px", color: "#18181b" }}>{data.customerCompanyName}</div>
        <div style={{ display: "flex", gap: "20px", marginTop: "6px", flexWrap: "wrap" }}>
          {data.customerContact && <span style={{ color: "#71717a", fontSize: "12px" }}>👤 {data.customerContact}</span>}
          {data.customerPhone && <span style={{ color: "#71717a", fontSize: "12px" }}>📞 {data.customerPhone}</span>}
          {data.customerEmail && <span style={{ color: "#71717a", fontSize: "12px" }}>✉ {data.customerEmail}</span>}
        </div>
        {data.serviceAddress && (
          <div style={{ marginTop: "6px", color: "#71717a", fontSize: "12px" }}>
            📍 {data.serviceAddress}
          </div>
        )}
      </div>

      {/* ── Thin divider ── */}
      <div style={{ height: "1px", background: "#e4e4e7", marginBottom: "24px" }} />

      {/* ── Items ── */}
      <div style={{ marginBottom: "8px" }}>
        {/* Table header */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 60px 80px 90px 60px 100px",
          gap: "8px", padding: "8px 0",
          borderBottom: "2px solid #18181b",
          fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#71717a"
        }}>
          <span>Item</span>
          <span style={{ textAlign: "right" }}>Qty</span>
          <span style={{ textAlign: "right" }}>Unit</span>
          <span style={{ textAlign: "right" }}>Price</span>
          <span style={{ textAlign: "right" }}>Tax</span>
          <span style={{ textAlign: "right" }}>Total</span>
        </div>

        {data.lineItems.map((item, idx) => {
          const lineTotal = item.quantity * item.unitPrice;
          const lineTax = (lineTotal * item.taxRate) / 100;
          const lineGross = lineTotal + lineTax;
          return (
            <div key={idx} style={{
              display: "grid", gridTemplateColumns: "1fr 60px 80px 90px 60px 100px",
              gap: "8px", padding: "14px 0",
              borderBottom: "1px solid #f4f4f5",
              alignItems: "start"
            }}>
              <div>
                <div style={{ fontWeight: 600, color: "#18181b" }}>{item.description}</div>
                {item.details && (
                  <div style={{ color: "#71717a", fontSize: "11px", marginTop: "3px", lineHeight: 1.5 }}>
                    {item.details}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", paddingTop: "2px" }}>{item.quantity}</div>
              <div style={{ textAlign: "right", paddingTop: "2px", color: "#71717a" }}>{item.unit}</div>
              <div style={{ textAlign: "right", paddingTop: "2px" }}>AED {item.unitPrice.toFixed(2)}</div>
              <div style={{ textAlign: "right", paddingTop: "2px", color: "#71717a" }}>{item.taxRate}%</div>
              <div style={{ textAlign: "right", paddingTop: "2px", fontWeight: 700, color: "#7c3aed" }}>
                AED {lineGross.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Totals ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px", marginBottom: "36px" }}>
        <div style={{ minWidth: "260px" }}>
          {[
            { label: "Subtotal", value: `AED ${subTotal.toFixed(2)}` },
            { label: "Discount", value: `− AED ${discount.toFixed(2)}` },
            { label: `VAT (${avgTax.toFixed(0)}%)`, value: `AED ${taxAmount.toFixed(2)}` },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#71717a", fontSize: "12px" }}>
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
          <div style={{ height: "1px", background: "#18181b", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ fontWeight: 800, fontSize: "15px" }}>Total</span>
            <span style={{ fontWeight: 800, fontSize: "15px", color: "#7c3aed" }}>AED {grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ── Notes ── */}
      {data.notes && (
        <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: "8px", padding: "14px 16px", marginBottom: "28px" }}>
          <div style={{ fontWeight: 600, fontSize: "11px", color: "#7c3aed", marginBottom: "4px" }}>Notes</div>
          <div style={{ color: "#52525b", fontSize: "12px" }}>{data.notes}</div>
        </div>
      )}

      {/* ── Terms ── */}
      <div style={{ background: "#f4f4f5", borderRadius: "10px", padding: "20px 24px" }}>
        <div style={{ fontWeight: 700, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#52525b", marginBottom: "12px" }}>
          Terms & Conditions
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px" }}>
          {[
            `Valid for ${data.validityDays ?? 7} days from issuance`,
            "100% advance payment required",
            "Access & NOC provided by client",
            "6-month workmanship warranty",
            "Weekdays only, 9am – 6pm",
            "Materials ownership retained until full payment",
          ].map((t, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11px", color: "#71717a" }}>
              <span style={{ color: "#7c3aed" }}>—</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        position: "absolute", bottom: "32px", left: "64px", right: "64px",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div style={{ height: "1px", background: "#e4e4e7", position: "absolute", top: 0, left: 0, right: 0 }} />
        <span style={{ color: "#a1a1aa", fontSize: "11px", marginTop: "12px" }}>{data.companyName}</span>
        {data.companyPhone && (
          <span style={{ color: "#a1a1aa", fontSize: "11px", marginTop: "12px" }}>Support: {data.companyPhone}</span>
        )}
      </div>
    </div>
  );
}
