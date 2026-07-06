import type { CSSProperties } from "react";
import { formatCurrencyAED } from "@/utils/format-currency";

import {
  BANK_DETAILS,
  CLAUSE_1_OPERATION,
  CLAUSE_2_INTRO,
  CLAUSE_3_EMERGENCY,
  CLAUSE_4_MATERIALS,
  CLAUSE_5_EXCLUDED,
  CLAUSE_6_2_INTRO,
  CLAUSE_6_3_HANDYMAN,
  CLAUSE_7_TERMS,
  CLAUSE_8_TERMINATION,
  getSelectedScopeSections,
  PRICE_LIST_ROWS,
} from "../amc-contract-content";
import { AMC_PROVIDER } from "../amc-constants";
import {
  formatDesignationLabel,
  formatDisplayDate,
  formatPaymentTermsLabel,
} from "../amc-pricing";
import type { AmcComputedData } from "../amc-types";
import {
  AmcRedBanner,
  AMC_PDF_STYLES,
  bodyText,
  brandRedText,
  clauseBulletItem,
  clauseLetterItem,
  clauseMainTitle,
  clauseParagraph,
  clauseSubTitle,
  CLAUSE_LAYOUT,
  highlightStyle,
  ScopeSectionBlock,
  tableCell,
} from "./amc-pdf";

interface Props {
  data: AmcComputedData;
  isPdf?: boolean;
}

const propertyLabelStyle: CSSProperties = {
  display: "block",
  // marginBottom: "6px",
  fontSize: "12px",
};

const propertyValueStyle: CSSProperties = {
  display: "block",
  textAlign: "center",
  fontWeight: 600,
  fontSize: "12px",
};

function buildTableStyles(isPdf: boolean) {
  const cell = tableCell(isPdf);

  return {
    redHeaderCell: {
      ...cell,
      backgroundColor: AMC_PDF_STYLES.TABLE_HEADER_RED,
      color: "#ffffff",
      fontWeight: 300,
      textAlign: "left" as const,
      fontSize: "12px",
    },
    beigeHeaderCell: {
      ...cell,
      backgroundColor: AMC_PDF_STYLES.TABLE_HEADER_BEIGE,
      fontWeight: 300,
      fontSize: "12px",
    },
    infoLabelCell: {
      ...cell,
      fontSize: "12px",
      background: "#eeece1a6",
    },
    propertyRowCell: {
      ...cell,
      fontSize: "12px",
      background: "#eeece1a6",
    },
    cell,
  };
}

function formatClausePhoneText(text: string) {
  const parts = text.split(/(800-PERFECT\s*\(7373328\))/gi);
  return parts.map((part, index) =>
    /800-PERFECT/i.test(part) ? (
      <span key={index} style={brandRedText}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function isClauseHighlightParagraph(text: string) {
  return (
    text.startsWith("Unlimited emergency call-outs") ||
    text.startsWith("Unlimited non-emergency call-outs")
  );
}

function Clause1Block({ isPdf }: { isPdf: boolean }) {
  return (
    <div>
      <div style={clauseMainTitle}>{CLAUSE_1_OPERATION.title}</div>
      {CLAUSE_1_OPERATION.sections.map((section) => (
        <div key={section.title}>
          <div style={{ ...clauseSubTitle, fontWeight: 700 }}>{section.title}</div>
          {"paragraphs" in section &&
            section.paragraphs?.map((paragraph) => (
              <div
                key={paragraph}
                style={{
                  ...clauseParagraph,
                  ...(isClauseHighlightParagraph(paragraph) ? highlightStyle(isPdf) : {}),
                }}
              >
                {formatClausePhoneText(paragraph)}
              </div>
            ))}
          {"bullets" in section &&
            section.bullets?.map((bullet) => (
              <div key={bullet} style={clauseBulletItem}>
                <span style={{ position: "absolute", left: "44px" }}>-</span>
                {bullet}
              </div>
            ))}
          {"listItems" in section &&
            section.listItems?.map((item, index) => (
              <div
                key={item}
                style={{
                  ...clauseLetterItem,
                  ...(index === 1 ? highlightStyle(isPdf) : {}),
                }}
              >
                {section.listType === "letter"
                  ? `${String.fromCharCode(65 + index)}. `
                  : "- "}
                {formatClausePhoneText(item)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Clause2IntroBlock() {
  return (
    <div>
      <div style={clauseMainTitle}>{CLAUSE_2_INTRO[0]}</div>
      {CLAUSE_2_INTRO.slice(1).map((line) => (
        <div key={line} style={clauseParagraph}>
          {line}
        </div>
      ))}
    </div>
  );
}

function Clause3Block() {
  return (
    <div>
      <div style={clauseMainTitle}>{CLAUSE_3_EMERGENCY.title}</div>
      {CLAUSE_3_EMERGENCY.sections.map((section) => (
        <div key={section.title}>
          <div style={{ ...clauseSubTitle, fontWeight: 700 }}>{section.title}</div>
          {section.bullets.map((bullet) => (
            <div key={bullet} style={clauseBulletItem}>
              <span style={{ position: "absolute", left: "44px" }}>-</span>
              {bullet}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Clause4Block() {
  return (
    <div>
      <div style={clauseMainTitle}>{CLAUSE_4_MATERIALS.title}</div>
      {CLAUSE_4_MATERIALS.paragraphs.map((paragraph) => (
        <div key={paragraph} style={clauseParagraph}>
          {paragraph}
        </div>
      ))}
    </div>
  );
}

function Clause5Block() {
  return (
    <div>
      <div style={clauseMainTitle}>{CLAUSE_5_EXCLUDED.title}</div>
      <div style={clauseParagraph}>{CLAUSE_5_EXCLUDED.intro}</div>
      {CLAUSE_5_EXCLUDED.bullets.map((bullet) => (
        <div key={bullet} style={clauseBulletItem}>
          <span style={{ position: "absolute", left: "44px" }}>-</span>
          {bullet}
        </div>
      ))}
      {CLAUSE_5_EXCLUDED.footerParagraphs.map((paragraph) => (
        <div key={paragraph} style={{ ...clauseParagraph, marginTop: "4px" }}>
          {paragraph}
        </div>
      ))}
    </div>
  );
}

export function AmcContractBody({ data, isPdf = false }: Props) {
  const { formData, totals, frequencyRows } = data;
  const contacts = formData.coordinationContacts;
  const totalAmountText = `${totals.annualSubtotal.toFixed(2)} AED (VAT EXCLUDED) + ${totals.vatAmount.toFixed(2)} AED VAT = ${totals.grandTotal.toFixed(2)} AED`;
  const selectedScopeSections = getSelectedScopeSections(formData.selectedServices);

  const text = bodyText;
  const {
    redHeaderCell,
    beigeHeaderCell,
    infoLabelCell,
    propertyRowCell,
    cell,
  } = buildTableStyles(isPdf);

  const addressCellPadding = isPdf ? "16px" : undefined;
  const contactHeadingMarginTop = "40px";
  const contactTableMarginBottom = "70px";
  const signatureMarginTop = "170px";

  return (
    <div data-amc-body style={{ width: "100%" }}>
      <AmcRedBanner title={data.packageTitle} isPdf={isPdf} />

      <div style={{ ...text, marginBottom: "6px", fontSize: "12px" }}>
        <span style={{ fontWeight: 700 }}>AMC PROPOSAL DATE:</span> {data.proposalDate}
        &nbsp;&nbsp;&nbsp;&nbsp;
        <span style={{ fontWeight: 700 }}>AMC PROPOSAL NUMBER:</span> {formData.proposalNumber}
      </div>

      <div style={{ ...text, fontWeight: 700, marginBottom: "6px", fontSize: "12px" }}>
        BETWEEN:
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ ...redHeaderCell, width: "50%" }}>SERVICE PROVIDER DETAILS</td>
            <td style={{ ...redHeaderCell, width: "50%" }}>CUSTOMER DETAILS</td>
          </tr>
          <tr>
            <td style={infoLabelCell}>{AMC_PROVIDER.companyName}</td>
            <td style={infoLabelCell}>{formData.customerName}</td>
          </tr>
          <tr>
            <td style={infoLabelCell}>P.O. Box: {AMC_PROVIDER.poBox}</td>
            <td style={infoLabelCell}>Customer ID: {formData.customerId || "XXX"}</td>
          </tr>
          <tr>
            <td style={infoLabelCell}>Contact No: {AMC_PROVIDER.contactNo}</td>
            <td style={infoLabelCell}>Contract Type: {AMC_PROVIDER.contractType}</td>
          </tr>
          <tr>
            <td style={infoLabelCell}>Email: {AMC_PROVIDER.email}</td>
            <td style={infoLabelCell}>Contact No: {formData.customerPhone}</td>
          </tr>
          <tr>
            <td style={infoLabelCell}>
              <div>Coordination Email Address:</div>
              {AMC_PROVIDER.coordinationEmails.map((email, index) => (
                <div key={`${email}-${index}`}>{email}</div>
              ))}
            </td>
            <td style={infoLabelCell}>
              <div>Email Address:</div>
              <div>Client: {formData.customerEmail}</div>
            </td>
          </tr>
          <tr>
            <td style={{ ...infoLabelCell, paddingBottom: addressCellPadding }}>
              <div style={{ marginBottom: "6px" }}>Company Address:</div>
              <div>{AMC_PROVIDER.address}</div>
            </td>
            <td style={{ ...infoLabelCell, paddingBottom: addressCellPadding }}>
              <div style={{ marginBottom: "6px" }}>Customer Address:</div>
              <div>{formData.propertyAddress}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", marginTop: "10px", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={propertyRowCell} colSpan={2}>
              <span style={propertyLabelStyle}>Property Detail:</span>
              <span style={propertyValueStyle}>{formData.propertyDetail}</span>
            </td>
          </tr>
          <tr>
            <td style={propertyRowCell} colSpan={2}>
              <span style={propertyLabelStyle}>Property Type:</span>
              <span style={propertyValueStyle}>{data.propertyTypeLabel}</span>
            </td>
          </tr>
          <tr>
            <td style={propertyRowCell} colSpan={2}>
              <span style={propertyLabelStyle}>Period of Service:</span>
              <span style={propertyValueStyle}>1 YEAR ONLY</span>
            </td>
          </tr>
          <tr>
            <td style={{ ...propertyRowCell, width: "50%" }}>
              <span style={propertyLabelStyle}>Starting From:</span>
              <span style={propertyValueStyle}>{formatDisplayDate(formData.startDate)}</span>
            </td>
            <td style={{ ...propertyRowCell, width: "50%" }}>
              <span style={propertyLabelStyle}>Expiration:</span>
              <span style={propertyValueStyle}>{data.endDate}</span>
            </td>
          </tr>
          <tr>
            <td style={propertyRowCell} colSpan={2}>
              <span style={propertyLabelStyle}>Total Amount:</span>
              <span style={propertyValueStyle}>{totalAmountText}</span>
            </td>
          </tr>
          <tr>
            <td style={propertyRowCell} colSpan={2}>
              <span style={propertyLabelStyle}>Amount in words:</span>
              <span style={propertyValueStyle}>{totals.amountInWords}</span>
            </td>
          </tr>
          <tr>
            <td style={propertyRowCell} colSpan={2}>
              <span style={propertyLabelStyle}>Terms of Payment:</span>
              <span style={propertyValueStyle}>
                {formatPaymentTermsLabel(formData.paymentTerms)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div
        style={{
          ...text,
          fontWeight: 700,
          marginTop: contactHeadingMarginTop,
          marginBottom: "8px",
          fontSize: "14px",
        }}
      >
        Customer coordination Contact Persons:
      </div>
      <table
        style={{
          width: "100%",
          marginTop: "2px",
          borderCollapse: "collapse",
          marginBottom: contactTableMarginBottom,
        }}
      >
        <tbody>
          {[contacts[0], contacts[1]].map((contact, index) => (
            <tr key={index}>
              <td style={{ ...propertyRowCell, width: "33.33%" }}>
                <span style={propertyLabelStyle}>Name:</span>
                <span style={{ display: "block" }}>{contact.name}</span>
              </td>
              <td style={{ ...propertyRowCell, width: "33.33%" }}>
                <span style={propertyLabelStyle}>Phone:</span>
                <span style={{ display: "block" }}>{contact.phone}</span>
              </td>
              <td style={{ ...propertyRowCell, width: "33.33%" }}>
                <span style={propertyLabelStyle}>Designation:</span>
                <span style={{ display: "block" }}>
                  {formatDesignationLabel(contact.designation)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Clause1Block isPdf={isPdf} />
      <Clause2IntroBlock />

      {selectedScopeSections.map((section) => (
        <ScopeSectionBlock key={section.serviceId} section={section} isPdf={isPdf} />
      ))}

      <Clause3Block />
      <Clause4Block />
      <Clause5Block />

      <div style={{ ...clauseMainTitle, marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP }}>
        6- Service Frequency and Provisions
      </div>
      <div style={{ ...clauseSubTitle, fontWeight: 700, marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP }}>
        6.1 Scope of work and frequency of the services of annual maintenance contract (
        {data.packageTitle})
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginTop: CLAUSE_LAYOUT.TABLE_TOP,
          marginBottom: CLAUSE_LAYOUT.TABLE_BOTTOM,
        }}
      >
        <thead>
          <tr>
            <td style={{ ...beigeHeaderCell, width: "55%" }}>SCOPE</td>
            <td style={{ ...beigeHeaderCell, width: "25%" }}>FREQUENCY</td>
            <td style={{ ...beigeHeaderCell, width: "20%" }}>REFERENCE</td>
          </tr>
        </thead>
        <tbody>
          {frequencyRows.map((row) => (
            <tr key={row.scope}>
              <td style={cell}>{row.scope}</td>
              <td style={cell}>{row.frequency}</td>
              <td style={cell}>{row.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {CLAUSE_6_2_INTRO.map((line, index) => (
        <div
          key={line}
          style={{
            ...clauseParagraph,
            marginTop: index === 0 ? CLAUSE_LAYOUT.PARAGRAPH_GAP : "2px",
            marginBottom:
              index === CLAUSE_6_2_INTRO.length - 1 ? CLAUSE_LAYOUT.PARAGRAPH_GAP : "2px",
          }}
        >
          {line}
        </div>
      ))}
      <table
        style={{
          width: "100%",
          marginTop: CLAUSE_LAYOUT.TABLE_TOP,
          marginBottom: CLAUSE_LAYOUT.TABLE_BOTTOM,
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            <td style={beigeHeaderCell}>No.</td>
            <td style={beigeHeaderCell}>Category</td>
            <td style={beigeHeaderCell}>Description</td>
            <td style={beigeHeaderCell}>Brand</td>
            <td style={beigeHeaderCell}>Price (AED)</td>
          </tr>
        </thead>
        <tbody>
          {PRICE_LIST_ROWS.map((row) => (
            <tr key={row.no}>
              <td style={cell}>{row.no}</td>
              <td style={cell}>{row.category}</td>
              <td style={cell}>{row.description}</td>
              <td style={cell}>{row.brand}</td>
              <td style={cell}>{row.price}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ ...clauseMainTitle, marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP }}>
        {CLAUSE_6_3_HANDYMAN.title}
      </div>
      {CLAUSE_6_3_HANDYMAN.rates.map((rate) => (
        <div key={rate.label} style={clauseParagraph}>
          {rate.label} {rate.text}
        </div>
      ))}

      <div style={{ ...clauseMainTitle, marginTop: CLAUSE_LAYOUT.TERMS_TOP, marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP }}>
        7- General Terms, Conditions and Payment
      </div>
      {CLAUSE_7_TERMS.map((term) => (
        <div key={term} style={clauseParagraph}>
          {term}
        </div>
      ))}

      <table
        style={{
          width: "100%",
          marginTop: CLAUSE_LAYOUT.TABLE_TOP,
          marginBottom: CLAUSE_LAYOUT.TABLE_BOTTOM,
          borderCollapse: "collapse",
        }}
      >
        <tbody>
          {BANK_DETAILS.map((row) => (
            <tr key={row.label}>
              <td style={{ ...cell, width: "35%", fontWeight: 700 }}>{row.label}</td>
              <td style={cell}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ ...clauseParagraph, marginTop: CLAUSE_LAYOUT.PARAGRAPH_GAP }}>
        Annual contract value: {formatCurrencyAED(totals.grandTotal)} (VAT included).
        Invoices to be settled within 7 working days from the date of invoice.
      </div>

      <div style={{ ...clauseMainTitle, marginTop: CLAUSE_LAYOUT.TERMS_TOP, marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP }}>
        {CLAUSE_8_TERMINATION.title}
      </div>
      {CLAUSE_8_TERMINATION.paragraphs.map((paragraph) => (
        <div key={paragraph} style={clauseParagraph}>
          {paragraph}
        </div>
      ))}

      <div
        style={{
          marginTop: signatureMarginTop,
          display: "flex",
          justifyContent: "space-between",
          gap: "20px",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              borderTop: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
              paddingTop: "4px",
              fontSize: AMC_PDF_STYLES.SMALL_SIZE,
            }}
          >
            On behalf of YALLA FIX IT ONE PERSON COMPANY LLC
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              borderTop: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
              paddingTop: "4px",
              fontSize: AMC_PDF_STYLES.SMALL_SIZE,
            }}
          >
            On behalf of Client — {formData.customerName}
          </div>
        </div>
      </div>

      <div style={{ ...text, marginTop: "10px", fontStyle: "italic" }}>
        {CLAUSE_8_TERMINATION.confirmation}
      </div>
    </div>
  );
}
