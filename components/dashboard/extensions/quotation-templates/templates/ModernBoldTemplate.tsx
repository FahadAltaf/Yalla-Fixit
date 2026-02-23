import React from "react";
import { QuotationData, calculateTotals } from "../quotation-templates";

interface Props {
  data: QuotationData;
}

export function ModernBoldTemplate({ data }: Props) {
  const { subTotal, discount, taxAmount, grandTotal, avgTax } = calculateTotals(data);

  return (
    <div
      id="quotation-pdf-root"
      style={{
        width: "794px",
        minHeight: "1123px",
        backgroundColor: "#ffffff",
        fontFamily: "'Georgia', serif",
        fontSize: "13px",
        color: "#0f172a",
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ── Dark Header Banner ── */}
      <div style={{
        background: "linear-gradient(135deg, #0f766e 0%, #134e4a 100%)",
        padding: "40px 56px 32px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Decorative circles */}
        <div style={{
          position: "absolute", right: "-40px", top: "-40px",
          width: "180px", height: "180px", borderRadius: "50%",
          background: "rgba(255,255,255,0.06)",
        }} />
        <div style={{
          position: "absolute", right: "60px", top: "20px",
          width: "80px", height: "80px", borderRadius: "50%",
          background: "rgba(255,255,255,0.04)",
        }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", position: "relative" }}>
          <div>
            <div style={{ fontSize: "28px", fontWeight: 900, color: "#ffffff", letterSpacing: "-1px" }}>
              {data.companyName}
            </div>
            <div style={{ color: "rgba(255,255,255,0.65)", marginTop: "6px", fontSize: "12px", lineHeight: 1.7 }}>
              {data.companyAddress}
              {data.companyWebsite && <><br />{data.companyWebsite}</>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              display: "inline-block", background: "rgba(255,255,255,0.15)",
              borderRadius: "8px", padding: "8px 16px", backdropFilter: "blur(4px)"
            }}>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Quotation
              </div>
              <div style={{ color: "#ffffff", fontWeight: 700, fontSize: "16px", marginTop: "2px" }}>
                {data.quotationNumber}
              </div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", marginTop: "2px" }}>
                {data.quotationDate}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Teal accent strip ── */}
      <div style={{ height: "4px", background: "linear-gradient(90deg, #14b8a6, #0f766e, #134e4a)" }} />

      {/* ── Body ── */}
      <div style={{ padding: "32px 56px" }}>

        {/* Customer + Service */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "32px" }}>
          <div style={{ background: "#f0fdf4", borderLeft: "3px solid #0f766e", borderRadius: "0 8px 8px 0", padding: "16px" }}>
            <div style={{ fontWeight: 700, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0f766e", marginBottom: "8px" }}>
              Billed To
            </div>
            <div style={{ fontWeight: 700, color: "#0f172a", lineHeight: 1.4 }}>{data.customerName}</div>
            {data.customerContact && <div style={{ color: "#475569", marginTop: "4px" }}>{data.customerContact}</div>}
            {data.customerPhone && <div style={{ color: "#475569" }}>{data.customerPhone}</div>}
            {data.customerEmail && <div style={{ color: "#475569" }}>{data.customerEmail}</div>}
          </div>
          {data.serviceAddress && (
            <div style={{ background: "#f8fafc", borderLeft: "3px solid #cbd5e1", borderRadius: "0 8px 8px 0", padding: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", marginBottom: "8px" }}>
                Site / Service Address
              </div>
              <div style={{ color: "#475569", lineHeight: 1.6 }}>{data.serviceAddress}</div>
            </div>
          )}
        </div>

        {/* Table */}
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, marginBottom: "8px" }}>
          <thead>
            <tr>
              {["Description", "Qty", "Unit", "Rate", "Tax", "Total"].map((h, i) => (
                <th key={h} style={{
                  padding: "10px 12px",
                  background: "#134e4a",
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  textAlign: i === 0 ? "left" : "right",
                  borderBottom: "2px solid #0f766e",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.lineItems.map((item, idx) => {
              const lineTotal = item.quantity * item.unitPrice;
              const lineTax = (lineTotal * item.taxRate) / 100;
              const lineGross = lineTotal + lineTax;
              return (
                <tr key={idx} style={{ background: idx % 2 === 0 ? "#f8fffe" : "#ffffff" }}>
                  <td style={{ padding: "14px 12px", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{item.description}</div>
                    {item.details && (
                      <div style={{ color: "#64748b", fontSize: "11px", marginTop: "4px", lineHeight: 1.5 }}>
                        {item.details}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "14px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0", verticalAlign: "top", fontWeight: 500 }}>{item.quantity}</td>
                  <td style={{ padding: "14px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0", verticalAlign: "top", color: "#64748b" }}>{item.unit}</td>
                  <td style={{ padding: "14px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>AED {item.unitPrice.toFixed(2)}</td>
                  <td style={{ padding: "14px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0", verticalAlign: "top", color: "#64748b", fontSize: "11px" }}>{item.taxRate}%</td>
                  <td style={{ padding: "14px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0", verticalAlign: "top", fontWeight: 700, color: "#0f766e" }}>
                    AED {lineGross.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "32px" }}>
          <div style={{ minWidth: "280px", background: "#f0fdf4", borderRadius: "10px", overflow: "hidden" }}>
            {[
              { label: "Sub Total", value: `AED ${subTotal.toFixed(2)}` },
              { label: "Discount", value: `- AED ${discount.toFixed(2)}` },
              { label: `VAT (${avgTax.toFixed(0)}%)`, value: `AED ${taxAmount.toFixed(2)}` },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #dcfce7" }}>
                <span style={{ color: "#475569", fontSize: "12px" }}>{label}</span>
                <span style={{ color: "#475569", fontSize: "12px" }}>{value}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: "#0f766e" }}>
              <span style={{ color: "#ffffff", fontWeight: 800, fontSize: "14px" }}>Grand Total</span>
              <span style={{ color: "#ffffff", fontWeight: 800, fontSize: "14px" }}>AED {grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {data.notes && (
          <div style={{
            background: "#fefce8", border: "1px solid #fde047",
            borderRadius: "8px", padding: "14px 16px", marginBottom: "24px", fontSize: "12px", color: "#713f12"
          }}>
            <strong>Note: </strong>{data.notes}
          </div>
        )}

        {/* Terms */}
        <div style={{ borderTop: "2px dashed #e2e8f0", paddingTop: "20px" }}>
          <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#0f766e", marginBottom: "12px" }}>
            Terms & Conditions
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {[
              `Valid for ${data.validityDays ?? 7} calendar days`,
              "100% advance payment required",
              "NOC & permits by client",
              "6-month workmanship warranty",
              "Work hours: Mon–Sat, 9am–6pm",
              "Electricity & water by client",
            ].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <span style={{ color: "#0f766e", fontWeight: 700, fontSize: "12px" }}>✓</span>
                <span style={{ color: "#64748b", fontSize: "11px" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background: "#134e4a", padding: "14px 56px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "absolute", bottom: 0, left: 0, right: 0
      }}>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px" }}>{data.companyName}</span>
        {data.companyPhone && (
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px" }}>Support: {data.companyPhone}</span>
        )}
      </div>
    </div>
  );
}
