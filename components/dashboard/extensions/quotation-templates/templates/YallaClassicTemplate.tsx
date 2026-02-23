import React from "react";
import { QuotationData, calculateTotals } from "../quotation-templates";

interface Props {
  data: QuotationData;
}

export function YallaClassicTemplate({ data }: Props) {
  const { subTotal, discount, taxAmount, grandTotal, avgTax } = calculateTotals(data);

  return (
    <div
      id="quotation-pdf-root"
      style={{
        width: "794px",
        minHeight: "1123px",
        backgroundColor: "#ffffff",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: "13px",
        color: "#1a1a2e",
        padding: "48px 56px",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "36px" }}>
        <div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#1a56db", letterSpacing: "-0.5px" }}>
            {data.companyName}
          </div>
          <div style={{ color: "#64748b", marginTop: "4px", lineHeight: 1.6, fontSize: "12px" }}>
            {data.companyAddress}
            {data.companyWebsite && <><br />{data.companyWebsite}</>}
          </div>
        </div>
    
      </div>

      {/* ── Divider ── */}
      <div style={{ height: "2px", background: "linear-gradient(90deg, #1a56db 0%, #e2e8f0 100%)", marginBottom: "28px" }} />

      {/* ── Customer + Service Address ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "28px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#1a56db", marginBottom: "8px" }}>
            Customer
          </div>
          <div style={{ fontWeight: 600, color: "#1e293b" }}>{data.customerName}</div>
          {data.customerContact && <div style={{ color: "#475569", marginTop: "2px" }}>{data.customerContact}</div>}
          {data.customerPhone && <div style={{ color: "#475569" }}>{data.customerPhone}</div>}
          {data.customerEmail && <div style={{ color: "#475569" }}>{data.customerEmail}</div>}
        </div>
            <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#1a56db", marginBottom: "8px" }}>

            Quotation
          </div>
          <div style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b", marginTop: "6px" }}>
            {data.quotationNumber}
          </div>
          <div style={{ color: "#64748b", fontSize: "12px", marginTop: "2px" }}>{data.quotationDate}</div>
        </div>
        {data.serviceAddress && (
          <div>
            <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#1a56db", marginBottom: "8px" }}>
              Service Address
            </div>
            <div style={{ color: "#475569", lineHeight: 1.6 }}>{data.serviceAddress}</div>
          </div>
        )}
      </div>

      {/* ── Line Items Table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <thead>
          <tr style={{ background: "#1a56db" }}>
            {["Service & Part", "Qty", "Unit", "List Price", "Tax", "Amount"].map((h, i) => (
              <th
                key={h}
                style={{
                  padding: "10px 12px",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  textAlign: i === 0 ? "left" : "right",
                  whiteSpace: "nowrap",
                }}
              >
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
              <tr
                key={idx}
                style={{ background: idx % 2 === 0 ? "#f8fafc" : "#ffffff", borderBottom: "1px solid #e2e8f0" }}
              >
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>
                    {item.description}
                  </div>
                  {item.details && (
                    <div style={{ color: "#64748b", fontSize: "11px", lineHeight: 1.6 }}>
                      {item.details}
                    </div>
                  )}
                </td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 500, verticalAlign: "top" }}>{item.quantity}</td>
                <td style={{ padding: "12px", textAlign: "right", verticalAlign: "top", color: "#64748b" }}>{item.unit}</td>
                <td style={{ padding: "12px", textAlign: "right", verticalAlign: "top" }}>AED {item.unitPrice.toFixed(2)}</td>
                <td style={{ padding: "12px", textAlign: "right", verticalAlign: "top", color: "#64748b", fontSize: "11px" }}>
                  Std [{item.taxRate}%]
                </td>
                <td style={{ padding: "12px", textAlign: "right", fontWeight: 600, verticalAlign: "top", color: "#1a56db" }}>
                  AED {lineGross.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Totals ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "32px" }}>
        <div style={{ minWidth: "260px" }}>
          {[
            { label: "Sub Total", value: subTotal, muted: false },
            { label: "Discount", value: discount, muted: true },
            { label: `Tax Amount (${avgTax.toFixed(0)}%)`, value: taxAmount, muted: true },
          ].map(({ label, value, muted }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ color: muted ? "#64748b" : "#1e293b", fontSize: "12px" }}>{label}</span>
              <span style={{ color: muted ? "#64748b" : "#1e293b", fontSize: "12px" }}>AED {value.toFixed(2)}</span>
            </div>
          ))}
          <div style={{
            display: "flex", justifyContent: "space-between", padding: "10px 12px",
            background: "#1a56db", borderRadius: "6px", marginTop: "8px"
          }}>
            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>Grand Total</span>
            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>AED {grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ── Terms ── */}
      <div style={{ borderTop: "2px solid #e2e8f0", paddingTop: "20px" }}>
        <div style={{ fontWeight: 700, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#1a56db", marginBottom: "10px" }}>
          Terms and Conditions
        </div>
        {[
          "This quotation is valid for 7 calendar days from the date of issuance. Approval received after this period may require areevaluation of the terms, total price, and duration of the work.",
          "Client approval confirmation and advance payment are mandatory prior to work commencement. Official approval must be provided via email or through an official LPO.",
          "Payment Terms: 100% advance. Accepted payment methods include cash, cheque, bank transfer, or payment link (proof of payment required). All payments are non-refundable. In case of cancellation, a refund may be issued in the form of a credit note, provided the work schedule is canceled at least 48 hours in advance and no materials have been purchased.",
          "Until full payment is made, Yalla Fix It retains ownership of all materials, equipment, and goods supplied for the project. The client agrees that Yalla Fix It reserves the right to reclaim these materials if the full payment is not received by the agreed payment date.",
          "Access, entry permits, necessary NOC, security deposit, etc., must be provided by the client. Any associated costs for professional certifications required for workers or third-party certifications are not included unless specifically mentioned. If any certification is needed, it will be subject to a separate quotation. Yalla Fix It will not be held liable for any delays or penalties resulting from non-compliance with local laws or regulations by the client.",
          "Work will be executed as per the scope outlined in this quotation. Any additional work beyond the scope may result in a revised quotation.Changes in quantity may lead to adjustments in the given unit rates. If the quantity on-site is found to be higher than the quoted amount,Yalla Fix It reserves the right to revise the quotation with the updated quantity, which may lead to changes in the total cost of the quote.Yalla Fix It is not liable for any defects in electromechanical items that are not directly part of the scope of work, whether such defects occur coincidentally or as a result of the functioning of other parts during the execution of the work.",
          "Duration of work is estimated as follows: 7 working days for fabrication, and 3 days for delivery and installation. The estimated timeline assumes continuous access to the site with no restrictions. Timelines begin upon sample approval and receipt of advance payment. Any delay in access or additional restrictions may impact the project timeline. No delay penalties will apply.",
          "Six-month workmanship warranty is provided where applicable, covering proven defects in workmanship if found within six months of completion. (Workmanship warranty does not apply to any cleaning-related scope of work.) Material warranty will follow the specific terms of the manufacturer. Any claims or replacements are the client’s responsibility and must be coordinated directly with the manufacturer’s agent.",
          "Yalla Fix It shall take all necessary precautions to avoid damage to the client's property during the performance of services. However, Yalla Fix It shall not be held liable for any incidental damage caused due to pre-existing conditions, hidden defects, or the client's failure to maintain their property as per standard maintenance practices. The client shall hold adequate insurance for property protection in case of any accidental damage. Yalla Fix It is covered by worker’s compensation insurance for personnel involved in the project. Yalla Fix It’s liability shall not exceed the total amount of the quotation. In no event shall Yalla Fix It be liable for any indirect, incidental, special, or consequential damages, including but not limited to loss of profits, loss of use, or any damage arising from delays or defects not directly related to the scope of work. The client acknowledges and agrees that this limitation of liability is a fundamental term of the agreement.",
          "Electricity and water supply must be provided by the client with no additional charge. If water and electricity need to be outsourced, additional fees will apply, and the project timeline may be affected.",
          "Work will be scheduled during weekdays only, Monday to Saturday, during working hours (9:00 am to 6:00 pm). If work outside of these hours or on non-working days is required, additional charges for overtime pay will apply"
        ].map((t, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "5px" }}>
            <span style={{ color: "#1a56db", fontWeight: 700, fontSize: "11px", minWidth: "16px" }}>{i + 1}.</span>
            <span style={{ color: "#64748b", fontSize: "11px", lineHeight: 1.6 }}>{t}</span>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{
        position: "absolute", bottom: "10px", left: "56px", right: "56px",
        borderTop: "1px solid #e2e8f0", paddingTop: "12px",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <span style={{ color: "#94a3b8", fontSize: "11px" }}>{data.companyName}</span>
        {data.companyPhone && (
          <span style={{ color: "#94a3b8", fontSize: "11px" }}>Support: {data.companyPhone}</span>
        )}
      </div>
    </div>
  );
}
