import type { CSSProperties } from "react";

import {
  buildProposalCommercialTerms,
  buildProposalServiceRows,
  formatProposalFee,
  getProposalAmcType,
  getProposalContactPerson,
  getProposalCoverageMonths,
  getProposalPropertyLabel,
  getProposalStartLabel,
  getProposalValidityLabel,
  PROPOSAL_IMPORTANT_NOTES,
} from "../amc-proposal-content";
import type { AmcComputedData } from "../amc-types";
import {
  AMC_PDF_STYLES,
  PDF_EXTRA_PADDING_BOTTOM,
} from "./amc-pdf/amc-pdf-styles";
import {
  AMC_PROPOSAL_STYLES,
  proposalLabel,
  proposalPanelPadding,
  proposalSectionTitle,
  proposalTableCell,
  proposalValue,
} from "./amc-pdf/amc-proposal-styles";

interface Props {
  data: AmcComputedData;
  isPdf?: boolean;
}

const contentPad: CSSProperties = {
  padding: "4px 0 8px",
  boxSizing: "border-box",
};

function DetailCell({
  label,
  value,
  width,
  isPdf,
}: {
  label: string;
  value: string;
  width?: string;
  isPdf: boolean;
}) {
  return (
    <td
      style={{
        ...proposalTableCell(false, isPdf),
        width,
        backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
      }}
    >
      <div style={proposalLabel}>{label}</div>
      <div style={{ ...proposalValue, marginTop: "2px" }}>{value}</div>
    </td>
  );
}

export function AmcProposalBody({ data, isPdf = false }: Props) {
  const { formData, totals, frequencyRows, proposalDate } = data;
  const serviceRows = buildProposalServiceRows(formData, frequencyRows);
  const commercialTerms = buildProposalCommercialTerms(formData);
  const coverageMonths = getProposalCoverageMonths(formData);
  const contactPerson = getProposalContactPerson(formData);
  const propertyLabel = getProposalPropertyLabel(formData);
  const amcType = getProposalAmcType(formData);
  const feeText = `AED ${formatProposalFee(totals.finalPrice)}`;
  const panelPad = proposalPanelPadding(isPdf);

  return (
    <div
      data-amc-body
      style={{
        width: "100%",
        fontFamily: AMC_PDF_STYLES.BODY_FONT,
        color: AMC_PDF_STYLES.TEXT_COLOR,
        backgroundColor: "#ffffff",
      }}
    >
      <div style={contentPad}>
        <div style={{ marginBottom: "14px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: 700,
              color: AMC_PDF_STYLES.TEXT_COLOR,
              lineHeight: 1.2,
              fontFamily: AMC_PDF_STYLES.BODY_FONT,
              ...(isPdf ? { paddingBottom: '10px' } : {}),
            }}
          >
            ANNUAL MAINTENANCE CONTRACT
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: AMC_PDF_STYLES.TITLE_SIZE,
              fontWeight: 700,
              color: AMC_PDF_STYLES.BRAND_RED,
              fontFamily: AMC_PDF_STYLES.BODY_FONT,
              ...(isPdf ? { paddingBottom: '15px' } : {}),
            }}
          >
            COMMERCIAL PROPOSAL
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "14px",
          }}
        >
          <div
            style={{
              flex: 1,
              backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
              border: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
              boxSizing: "border-box",
              ...panelPad,
            }}
          >
            <div style={{ marginBottom: "8px" }}>
              <div style={proposalLabel}>Prepared for:</div>
              <div
                style={{
                  ...proposalValue,
                }}
              >
                {formData.customerName || "—"}
              </div>
            </div>
            <div>
              <div style={proposalLabel}>Property:</div>
              <div
                style={{
                  ...proposalValue,
                  ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
                }}
              >
                {propertyLabel}
              </div>
            </div>
          </div>

          <div
            style={{
              width: "170px",
              backgroundColor: AMC_PROPOSAL_STYLES.ACCENT_SOFT,
              border: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              ...panelPad,
            }}
          >
            <div
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: AMC_PDF_STYLES.BRAND_RED,
                lineHeight: 1.1,
                fontFamily: AMC_PDF_STYLES.BODY_FONT,
              }}
            >
              {coverageMonths} MONTHS
            </div>
            <div
              style={{
                marginTop: "4px",
                fontSize: AMC_PDF_STYLES.SMALL_SIZE,
                fontWeight: 600,
                color: AMC_PROPOSAL_STYLES.MUTED,
                fontFamily: AMC_PDF_STYLES.BODY_FONT,
              }}
            >
              AMC Coverage
            </div>
          </div>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <h2
            style={{
              ...proposalSectionTitle,
              ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),

            }}
          >
            Proposal Details
          </h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <tbody>
              <tr>
                <DetailCell
                  label="Proposal Ref."
                  value={formData.proposalNumber}
                  width="50%"
                  isPdf={isPdf}
                />
                <DetailCell
                  label="Proposal Date"
                  value={proposalDate}
                  width="50%"
                  isPdf={isPdf}
                />
              </tr>
              <tr>
                <DetailCell
                  label="Contact Person"
                  value={contactPerson}
                  isPdf={isPdf}
                />
                <DetailCell
                  label="Validity"
                  value={getProposalValidityLabel()}
                  isPdf={isPdf}
                />
              </tr>
              <tr>
                <DetailCell
                  label="Contract Start"
                  value={getProposalStartLabel(formData)}
                  isPdf={isPdf}
                />
                <DetailCell label="AMC Type" value={amcType} isPdf={isPdf} />
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <h2
            style={{
              ...proposalSectionTitle,
              ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
            }}
          >
            Services Included
          </h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr>
                <th style={{ ...proposalTableCell(true, isPdf), width: "22%" }}>
                  Service
                </th>
                <th style={{ ...proposalTableCell(true, isPdf), width: "53%" }}>
                  Coverage
                </th>
                <th style={{ ...proposalTableCell(true, isPdf), width: "25%" }}>
                  Frequency
                </th>
              </tr>
            </thead>
            <tbody>
              {serviceRows.map((row, index) => {
                const alt = index % 2 === 1;
                const cellStyle: CSSProperties = {
                  ...proposalTableCell(false, isPdf),
                  backgroundColor: alt
                    ? AMC_PROPOSAL_STYLES.ROW_ALT
                    : AMC_PROPOSAL_STYLES.WHITE,
                };
                return (
                  <tr key={`${row.service}-${index}`}>
                    <td style={{ ...cellStyle, fontWeight: 700 }}>
                      {row.service}
                    </td>
                    <td style={cellStyle}>{row.coverage}</td>
                    <td style={cellStyle}>{row.frequency}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <h2
            style={{
              ...proposalSectionTitle,
              ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
            }}
          >
            Commercial Offer
          </h2>

          <div
            style={{
              display: "flex",
              border: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
              borderBottom: "none",
            }}
          >
            <div
              style={{
                flex: 1,
                backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                fontSize: AMC_PDF_STYLES.BODY_SIZE,
                fontWeight: 700,
                color: AMC_PDF_STYLES.TEXT_COLOR,
                fontFamily: AMC_PDF_STYLES.BODY_FONT,
                ...(isPdf ? { paddingBottom: '20px' } : {}),
              }}
            >
              Annual Maintenance Contract Fee
            </div>
            <div
              style={{
                width: "220px",
                backgroundColor: AMC_PROPOSAL_STYLES.ACCENT_SOFT,
                padding: "10px 12px",
                textAlign: "center",
                boxSizing: "border-box",
                borderLeft: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
                // ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
              }}
            >
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: AMC_PDF_STYLES.BRAND_RED,
                  lineHeight: 1.1,
                  fontFamily: AMC_PDF_STYLES.BODY_FONT,
                  // ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
                }}
              >
                {feeText}
              </div>
              <div
                style={{
                  marginTop: "3px",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: AMC_PROPOSAL_STYLES.MUTED,
                  fontFamily: AMC_PDF_STYLES.BODY_FONT,
                  ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
                }}
              >
                Excluding 5% VAT
              </div>
            </div>
          </div>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <tbody>
              {commercialTerms.map((term) => (
                <tr key={term.label}>
                  <td
                    style={{
                      ...proposalTableCell(false, isPdf),
                      width: "45%",
                      backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
                      fontWeight: 600,
                    }}
                  >
                    {term.label}
                  </td>
                  <td style={proposalTableCell(false, isPdf)}>{term.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <h2
            style={{
              ...proposalSectionTitle,
              color: AMC_PDF_STYLES.BRAND_RED,
              // ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
            }}
          >
            Important Notes
          </h2>
          <ul
            style={{
              margin: 0,
              paddingLeft: "18px",
              fontSize: AMC_PDF_STYLES.SMALL_SIZE,
              lineHeight: 1.45,
              color: AMC_PDF_STYLES.TEXT_COLOR,
              fontFamily: AMC_PDF_STYLES.BODY_FONT,
            }}
          >
            {PROPOSAL_IMPORTANT_NOTES.map((note) => (
              <li
                key={note}
                style={{
                  marginBottom: "4px",
                  // ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
                }}
              >
                {note}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ marginBottom: "8px" }}>
          <h2
            style={{
              ...proposalSectionTitle,
              ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
            }}
          >
            Client Acceptance
          </h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    ...proposalTableCell(false, isPdf),
                    width: "50%",
                    height: "64px",
                    backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
                  }}
                >
                  <div style={proposalLabel}>Name</div>
                  <div style={{ ...proposalValue, marginTop: "6px" }}>
                    {formData.customerName || "—"}
                  </div>
                </td>
                <td
                  style={{
                    ...proposalTableCell(false, isPdf),
                    width: "50%",
                    height: "64px",
                    backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
                  }}
                >
                  <div style={proposalLabel}>Signature</div>
                </td>
              </tr>
              <tr>
                <td
                  style={{
                    ...proposalTableCell(false, isPdf),
                    height: "64px",
                    backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
                  }}
                >
                  <div style={proposalLabel}>Date</div>
                  <div style={{ ...proposalValue, marginTop: "6px" }}>
                    {proposalDate}
                  </div>
                </td>
                <td
                  style={{
                    ...proposalTableCell(false, isPdf),
                    height: "64px",
                    backgroundColor: AMC_PROPOSAL_STYLES.PANEL,
                  }}
                >
                  <div style={proposalLabel}>Company Stamp</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
