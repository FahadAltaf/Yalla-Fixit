import { QuotationData, calculateTotals } from "../quotation-templates";
import yallaFixit from "@/public/yalla-fixit.png";

interface Props {
  data: QuotationData;
  hideDiscount?: boolean;
  /** When true, applies PDF-specific layout tweaks (e.g. header offset). Only set when rendering for PDF download. */
  forPDF?: boolean;
}

export function YallaClassicTemplate({ data, hideDiscount = false, forPDF = false }: Props) {
  const calculated = calculateTotals(data);
  const subTotal = data.subTotal || calculated.subTotal;
  const discount =
    data.discountAmount ??
    data.lineItems?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) ??
    calculated.discount;
  const taxAmount = data.taxAmount || calculated.taxAmount;
  const grandTotal = data.grandTotal || calculated.grandTotal;
  const avgTax = calculated.avgTax;

  // Parse Terms & Conditions from API:
  // - Strip leading "Notes:" label
  // - Split into items on newlines that start with "1-", "2-", etc.
  const termsLines = data.termsAndConditions
    ? data.termsAndConditions
        .replace(/^Notes:\s*/i, "")
        .split(/\r?\n(?=\d+-)/)
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

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
        ...(forPDF ? { paddingTop: "0px", paddingBottom:'0px' } : { paddingTop: "48px" }),

        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div style={{ display: "flex", justifyContent: "", alignItems: "flex-start",gap: "10px", marginBottom: "36px" }}>
      {/* <Image src={yallaFixit} width={100} height={100} alt="Yalla Fixit" style={{ width: "100px", height: "100px", objectFit: "contain", objectPosition: "left" }} /> */}
       <img src={yallaFixit.src} alt="Yalla Fixit" style={{ width: "70px", height: "70px", objectFit: "contain", objectPosition: "left" }} />
        <div style={forPDF ? { position: "relative", top: "-8px" } : undefined}>
          <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            {data.companyName}
          </div>
          <div style={{   lineHeight: 1.6, fontSize: "11px" }}>
          Office 102, Building 6, Gold & Diamond Park,
          Dubai,
             <><br /><a href="https://www.yallafixit.ae" target="_blank" rel="noopener noreferrer">https://www.yallafixit.ae</a></>

          </div>
        </div>
    
      </div>
      <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: "14px",    marginBottom: "4px" }}>

            Quotation
          </div>
          <div style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b", marginTop: "6px" }}>
            {data.quotationNumber}
          </div>
          <div style={{ color: "#64748b", fontSize: "11px", marginTop: "2px" }}>{data.quotationDate}</div>
        </div>
        </div>
      {/* ── Divider ── */}
      {/* <div style={{ height: "2px", background: "linear-gradient(90deg, #1a56db 0%, #e2e8f0 100%)", marginBottom: "28px" }} /> */}

      {/* ── Customer + Service Address ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "28px" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: "14px",    marginBottom: "4px" }}>
            Customer
          </div>
          <div style={{ fontWeight: 600  }}>{data.customerCompanyName}</div>
          {data.customerContact && <div style={{ marginTop: "2px" }}>{data.customerContact}</div>}
          {data.customerPhone && <div style={{  }}>{data.customerPhone}</div>}
            {data.customerEmail && <div style={{  }}>{data.customerEmail}</div>}
            {data.customerId && <div style={{  }}>{data.customerId}</div>}
        </div>
       
        {data.serviceAddress && (
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px",    marginBottom: "4px" }}>
              Service Address
            </div>
            <div style={{ color: "#475569", lineHeight: 1.6 }}>{data.serviceAddress}</div>
          </div>
        )}
      </div>

      {/* ── Line Items Table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
        <thead>
          <tr style={{ background: "black" }}>
            {(hideDiscount
              ? ["Service & Part", "Qty", "Unit", "List Price", "Amount"]
              : ["Service & Part", "Qty", "Unit", "List Price", "Discount", "Amount"]
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
                  textAlign: i === 0 ? "left" : "right",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{  }}>{h}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.lineItems.map((item, idx) => {
            const lineTotal = item.quantity * item.unitPrice;
            const lineTax = (lineTotal * item.taxRate) / 100;
            const lineItemAmount = (item.unitPrice * item.quantity) - item?.discountAmount ;
            const lineGross =
              typeof item.lineAmount === "number"
                ? item.lineAmount
                : lineTotal + lineTax;
            return (
              <tr
                key={idx}
                style={{ background: idx % 2 === 0 ? "#f8fafc" : "#ffffff", borderBottom: "1px solid #e2e8f0" }}
              >
                <td style={{     ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), verticalAlign: "top" }}>
                  <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "4px", fontSize: "11px",  }}>
                    {item.description}
                  </div>
                  {item.details && (
                    <div style={{ color: "#64748b", fontSize: "11px" }}>
                      {item.details}
                    </div>
                  )}
                </td>
                <td style={{fontSize: "11px",     ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", fontWeight: 500, verticalAlign: "top" }}>{item.quantity}</td>
                <td style={{fontSize: "11px",     ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", verticalAlign: "top", color: "#64748b" }}>{item.unit}</td>
                <td style={{fontSize: "11px", width:"100px",     ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", verticalAlign: "top" }}>AED {item.unitPrice.toFixed(2)}</td>
                {!hideDiscount && (
                  <td style={{fontSize: "11px",width:"86px",      ...(forPDF
                      ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                      : { padding: "12px" }), textAlign: "right", verticalAlign: "top", color: "#64748b" }}>
                    AED {item?.discountAmount?.toFixed(2)}
                  </td>
                )}
                <td style={{fontSize: "11px", width:"100px",     ...(forPDF
                    ? { paddingBottom: "15px", paddingLeft: "12px", paddingRight: "12px" }
                    : { padding: "12px" }), textAlign: "right", fontWeight: 600, verticalAlign: "top", color: "black" }}>
                  AED {lineItemAmount.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Totals ── */}
      <div id="totals-block" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "32px" }}>
        <div style={{ minWidth: "260px" }}>
          {[
            { key: "subTotal", label: "Sub Total", value: data?.lineItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity || 0), 0), muted: false },
            { key: "discount", label: "Discount", value: data?.lineItems.reduce((sum, item) => sum + (item.discountAmount || 0), 0), muted: true },
            {
              key: "taxAmount",
              label: data.taxAmount != null ? "Tax Amount (5%)" : `Tax Amount (${avgTax.toFixed(0)}%)`,
              value: taxAmount ,
              muted: true,
            },
          ]
            .filter((row) => !(hideDiscount && row.key === "discount"))
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
                <span style={{ color: muted ? "#64748b" : "#1e293b", fontSize: "11px" }}>AED {typeof value === "number" ? value.toFixed(2) : value}</span>
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
            <span style={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}>AED {grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ── Terms ── */}
      <div  id="terms-block" style={{ paddingTop: "40px" }}>
        <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase",  marginBottom: "10px" }}>
          Terms and Conditions
        </div>
        {termsLines && termsLines.length > 0 && (
          termsLines.map((line, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "5px" }}>
              <span style={{  fontSize: "9px"}}>{line}</span>
            </div>
          ))
        )}
      </div>

      {/* ── Bank Details & Support ── */}
      <div id="bank-details-block" style={{  paddingTop: "20px",}}>
        <div style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase"}}>
          Bank Details & Support
        </div>
        <div style={{  fontSize: "10px", lineHeight: 1.7 }}>
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

    </div>
  );
}
