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
  ScopeSectionBlock,
  sectionTitle,
  tableCell,
} from "./amc-pdf";

interface Props {
  data: AmcComputedData;
}

const redHeaderCell: CSSProperties = {
  ...tableCell,
  backgroundColor: AMC_PDF_STYLES.TABLE_HEADER_RED,
  color: "#ffffff",
  fontWeight: 700,
  textAlign: "left",
  fontSize: "10px",
  padding: "4px 6px",
};

const beigeHeaderCell: CSSProperties = {
  ...tableCell,
  backgroundColor: AMC_PDF_STYLES.TABLE_HEADER_BEIGE,
  fontWeight: 700,
  fontSize: "10px",
  padding: "4px 6px",
};

const infoLabelCell: CSSProperties = {
  ...tableCell,
  fontSize: "10px",
  padding: "4px 6px",
  verticalAlign: "top",
};

const propertyRowCell: CSSProperties = {
  ...tableCell,
  fontSize: "10px",
  padding: "5px 6px 10px",
  verticalAlign: "top",
};

const propertyLabelStyle: CSSProperties = {
  display: "block",
  marginBottom: "6px",
};

const propertyValueStyle: CSSProperties = {
  display: "block",
  textAlign: "center",
  fontWeight: 600,
};

function Clause1Block() {
  return (
    <div style={{ marginTop: "10px" }}>
      <div style={sectionTitle}>{CLAUSE_1_OPERATION.title}</div>
      {CLAUSE_1_OPERATION.sections.map((section) => (
        <div key={section.title} style={{ marginBottom: "6px" }}>
          <div style={{ ...bodyText, fontWeight: 700 }}>{section.title}</div>
          {"paragraphs" in section &&
            section.paragraphs?.map((paragraph) => (
              <div key={paragraph} style={bodyText}>
                {paragraph}
              </div>
            ))}
          {"bullets" in section &&
            section.bullets?.map((bullet) => (
              <div key={bullet} style={{ ...bodyText, paddingLeft: "10px" }}>
                - {bullet}
              </div>
            ))}
          {"listItems" in section &&
            section.listItems?.map((item, index) => (
              <div key={item} style={{ ...bodyText, paddingLeft: "10px" }}>
                {section.listType === "letter"
                  ? `${String.fromCharCode(97 + index)}. `
                  : "- "}
                {item}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Clause2IntroBlock() {
  return (
    <div style={{ marginTop: "10px" }}>
      {CLAUSE_2_INTRO.map((line) => (
        <div key={line} style={bodyText}>
          {line}
        </div>
      ))}
    </div>
  );
}

function Clause3Block() {
  return (
    <div style={{ marginTop: "10px" }}>
      <div style={sectionTitle}>{CLAUSE_3_EMERGENCY.title}</div>
      {CLAUSE_3_EMERGENCY.sections.map((section) => (
        <div key={section.title} style={{ marginBottom: "6px" }}>
          <div style={{ ...bodyText, fontWeight: 700 }}>{section.title}</div>
          {section.bullets.map((bullet) => (
            <div key={bullet} style={{ ...bodyText, paddingLeft: "10px" }}>
              - {bullet}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Clause4Block() {
  return (
    <div style={{ marginTop: "10px" }}>
      <div style={sectionTitle}>{CLAUSE_4_MATERIALS.title}</div>
      {CLAUSE_4_MATERIALS.paragraphs.map((paragraph) => (
        <div key={paragraph} style={bodyText}>
          {paragraph}
        </div>
      ))}
    </div>
  );
}

function Clause5Block() {
  return (
    <div style={{ marginTop: "10px" }}>
      <div style={sectionTitle}>{CLAUSE_5_EXCLUDED.title}</div>
      <div style={bodyText}>{CLAUSE_5_EXCLUDED.intro}</div>
      {CLAUSE_5_EXCLUDED.bullets.map((bullet) => (
        <div key={bullet} style={{ ...bodyText, paddingLeft: "10px" }}>
          - {bullet}
        </div>
      ))}
      {CLAUSE_5_EXCLUDED.footerParagraphs.map((paragraph) => (
        <div key={paragraph} style={{ ...bodyText, marginTop: "4px" }}>
          {paragraph}
        </div>
      ))}
    </div>
  );
}

export function AmcContractBody({ data }: Props) {
  const { formData, totals, frequencyRows } = data;
  const contacts = formData.coordinationContacts;
  const totalAmountText = `${totals.annualSubtotal.toFixed(2)} AED (VAT EXCLUDED) + ${totals.vatAmount.toFixed(2)} AED VAT = ${totals.grandTotal.toFixed(2)} AED`;
  const selectedScopeSections = getSelectedScopeSections(formData.selectedServices);

  return (
    <div data-amc-body style={{ width: "100%" }}>
      <AmcRedBanner title={data.packageTitle} />

      <div style={{ ...bodyText, marginBottom: "6px", fontSize: "12px" }}>
        <span style={{ fontWeight: 700 }}>AMC PROPOSAL DATE:</span> {data.proposalDate}
        &nbsp;&nbsp;&nbsp;&nbsp;
        <span style={{ fontWeight: 700 }}>AMC PROPOSAL NUMBER:</span> {formData.proposalNumber}
      </div>

      <div style={{ ...bodyText, fontWeight: 700, marginBottom: "2px", fontSize: "12px" }}>
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
            <td style={{ ...infoLabelCell, paddingBottom: "16px" }}>
              <div style={{ marginBottom: "6px" }}>Company Address:</div>
              <div>{AMC_PROVIDER.address}</div>
            </td>
            <td style={{ ...infoLabelCell, paddingBottom: "16px" }}>
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

      <div style={{ ...bodyText, fontWeight: 700, marginTop: "10px", fontSize: "10px" }}>
        Customer coordination Contact Persons:
      </div>
      <table style={{ width: "100%", marginTop: "2px", borderCollapse: "collapse" }}>
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

      <Clause1Block />
      <Clause2IntroBlock />

      {selectedScopeSections.map((section) => (
        <ScopeSectionBlock key={section.serviceId} section={section} />
      ))}

      <Clause3Block />
      <Clause4Block />
      <Clause5Block />

      <div style={{ ...sectionTitle, marginTop: "10px" }}>6- Service Frequency and Provisions</div>
      <div style={{ ...bodyText, fontWeight: 700, marginBottom: "4px" }}>
        6.1 Scope of work and frequency of the services of annual maintenance contract (
        {data.packageTitle})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
              <td style={tableCell}>{row.scope}</td>
              <td style={tableCell}>{row.frequency}</td>
              <td style={tableCell}>{row.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {CLAUSE_6_2_INTRO.map((line) => (
        <div key={line} style={{ ...bodyText, marginTop: "6px" }}>
          {line}
        </div>
      ))}
      <table style={{ width: "100%", marginTop: "4px", borderCollapse: "collapse" }}>
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
              <td style={tableCell}>{row.no}</td>
              <td style={tableCell}>{row.category}</td>
              <td style={tableCell}>{row.description}</td>
              <td style={tableCell}>{row.brand}</td>
              <td style={tableCell}>{row.price}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ ...sectionTitle, marginTop: "10px" }}>{CLAUSE_6_3_HANDYMAN.title}</div>
      {CLAUSE_6_3_HANDYMAN.rates.map((rate) => (
        <div key={rate.label} style={bodyText}>
          {rate.label} {rate.text}
        </div>
      ))}

      <div style={{ ...sectionTitle, marginTop: "10px" }}>
        7- General Terms, Conditions and Payment
      </div>
      {CLAUSE_7_TERMS.map((term) => (
        <div key={term} style={bodyText}>
          {term}
        </div>
      ))}

      <table style={{ width: "100%", marginTop: "6px", borderCollapse: "collapse" }}>
        <tbody>
          {BANK_DETAILS.map((row) => (
            <tr key={row.label}>
              <td style={{ ...tableCell, width: "35%", fontWeight: 700 }}>{row.label}</td>
              <td style={tableCell}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ ...bodyText, marginTop: "4px" }}>
        Annual contract value: {formatCurrencyAED(totals.grandTotal)} (VAT included).
        Invoices to be settled within 7 working days from the date of invoice.
      </div>

      <div style={{ ...sectionTitle, marginTop: "10px" }}>{CLAUSE_8_TERMINATION.title}</div>
      {CLAUSE_8_TERMINATION.paragraphs.map((paragraph) => (
        <div key={paragraph} style={bodyText}>
          {paragraph}
        </div>
      ))}

      <div
        style={{
          marginTop: "210px",
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

      <div style={{ ...bodyText, marginTop: "10px", fontStyle: "italic" }}>
        {CLAUSE_8_TERMINATION.confirmation}
      </div>
    </div>
  );
}
