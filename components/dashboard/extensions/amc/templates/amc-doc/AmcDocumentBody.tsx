import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

import type { AmcDocumentModel, Block, Cell, Run, Tone } from "../../amc-document-model";
import { AMC_DOC_COLORS, AMC_DOC_FONT, AMC_DOC_PT, pt } from "./amc-doc-theme";

/**
 * Draws an AMC document model (amc-document-model.ts) as HTML — for the
 * on-screen previews, the client link, and the PDF, which is captured from
 * this markup.
 *
 * Every element a page may start at carries data-amc-break, so the PDF
 * paginator breaks between rows and paragraphs instead of through them.
 * A heading carries data-amc-keep as well: a page never ends on a heading
 * whose text is on the next page.
 */

/*
  html2canvas draws text lower inside a box than the browser does, so in
  the PDF the text of a cell sat on its bottom border. When rendering for
  the PDF, boxes drop their top padding and take it, plus a little more, at
  the bottom: the same correction the quotation template makes (forPDF).
  The on-screen document is untouched.
*/
export const AmcPdfRenderContext = createContext(false);

const cellPadding = (pdf: boolean) => (pdf ? "0 8px 12px" : "6px 8px");
const bannerPadding = (pdf: boolean) => (pdf ? "0 12px 16px" : "8px 12px");

const toneColor: Record<Tone, string> = {
  default: AMC_DOC_COLORS.text,
  muted: AMC_DOC_COLORS.muted,
  brand: AMC_DOC_COLORS.brand,
  white: AMC_DOC_COLORS.white,
};

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <span
          key={index}
          style={{
            fontWeight: run.bold ? 700 : undefined,
            color: run.tone ? toneColor[run.tone] : undefined,
            whiteSpace: "pre-wrap",
          }}
        >
          {run.text}
        </span>
      ))}
    </>
  );
}

/* Font set on every element, not inherited: the app stylesheet styles
   h2/h3 with its own heading font, which must not reach the document. */
const text: CSSProperties = {
  fontFamily: AMC_DOC_FONT,
  letterSpacing: "normal",
  fontSize: pt(AMC_DOC_PT.body),
  lineHeight: 1.5,
  color: AMC_DOC_COLORS.text,
  margin: "0 0 5px",
};

const cellFill: Record<NonNullable<Cell["shade"]>, string> = {
  brand: AMC_DOC_COLORS.brand,
  label: AMC_DOC_COLORS.labelFill,
  zebra: AMC_DOC_COLORS.zebraFill,
};

function TableCell({ cell, width, header }: { cell: Cell; width: number; header?: boolean }) {
  const pdf = useContext(AmcPdfRenderContext);
  return (
    <td
      style={{
        width: `${width}%`,
        border: `1px solid ${AMC_DOC_COLORS.border}`,
        padding: cellPadding(pdf),
        verticalAlign: "top",
        textAlign: cell.align ?? "left",
        backgroundColor: cell.shade ? cellFill[cell.shade] : AMC_DOC_COLORS.white,
        fontFamily: AMC_DOC_FONT,
        fontSize: pt(header ? AMC_DOC_PT.tableHeader : AMC_DOC_PT.table),
        lineHeight: 1.45,
        color: AMC_DOC_COLORS.text,
      }}
    >
      {cell.lines.map((line, index) => (
        <div key={index}>
          <Runs runs={line} />
        </div>
      ))}
      {cell.images && cell.images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", marginTop: "8px" }}>
          {cell.images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas
            <img key={src} src={src} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
          ))}
        </div>
      )}
    </td>
  );
}

function renderBlock(block: Block, key: number, keepWithPrevious: boolean, pdf: boolean): ReactNode {
  /* An element right after a heading is not a place to break. */
  const breakAttr = keepWithPrevious ? {} : { "data-amc-break": "" };

  switch (block.kind) {
    case "contactStrip":
      return (
        <div key={key} {...breakAttr} style={{ ...text, fontSize: pt(AMC_DOC_PT.small), color: AMC_DOC_COLORS.muted }}>
          Toll Free 800-PERFECT (7373328)
          <span style={{ color: AMC_DOC_COLORS.brand, padding: "0 10px" }}>|</span>
          ISO 9001 / 14001 / 45001 Certified
        </div>
      );

    case "banner":
      return (
        <div
          key={key}
          {...breakAttr}
          style={{
            backgroundColor: AMC_DOC_COLORS.brand,
            color: AMC_DOC_COLORS.white,
            fontFamily: AMC_DOC_FONT,
            fontWeight: 700,
            fontSize: pt(AMC_DOC_PT.banner),
            padding: bannerPadding(pdf),
            margin: "8px 0 10px",
            letterSpacing: "0.2px",
          }}
        >
          {block.text}
        </div>
      );

    case "meta":
      return (
        <p key={key} {...breakAttr} style={{ ...text, margin: "0 0 10px" }}>
          {block.items.map((item, index) => (
            <span key={item.label} style={{ marginRight: index < block.items.length - 1 ? "40px" : 0 }}>
              <span style={{ fontWeight: 700 }}>{item.label}</span>
              {"  "}
              {item.value}
            </span>
          ))}
        </p>
      );

    case "label":
      return (
        <p key={key} {...breakAttr} data-amc-keep="" style={{ ...text, fontWeight: 700, color: AMC_DOC_COLORS.muted, margin: "14px 0 6px" }}>
          {block.text}
        </p>
      );

    case "table":
      return (
        <table
          key={key}
          style={{
            width: block.width ? `${block.width}%` : "100%",
            marginLeft: block.width ? "auto" : undefined,
            borderCollapse: "collapse",
            tableLayout: "fixed",
            marginBottom: "12px",
          }}
        >
          <tbody>
            {block.header && (
              <tr {...breakAttr}>
                {block.header.map((c, index) => (
                  <TableCell key={index} cell={c} width={block.widths[index]} header />
                ))}
              </tr>
            )}
            {block.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                /* The first body row stays with its header row. */
                {...(block.header && rowIndex === 0 ? {} : rowIndex === 0 ? breakAttr : { "data-amc-break": "" })}
              >
                {row.map((c, index) => (
                  <TableCell key={index} cell={c} width={block.widths[index]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case "heading":
      return (
        <h2
          key={key}
          {...breakAttr}
          data-amc-keep=""
          style={{ ...text, fontSize: pt(AMC_DOC_PT.heading), fontWeight: 700, margin: "20px 0 8px" }}
        >
          <span style={{ color: AMC_DOC_COLORS.brand }}>{block.number}</span>
          <span style={{ marginLeft: "10px" }}>{block.text}</span>
        </h2>
      );

    case "subheading":
      return (
        <h3
          key={key}
          {...breakAttr}
          data-amc-keep=""
          style={{ ...text, fontSize: pt(AMC_DOC_PT.subheading), fontWeight: 700, margin: "12px 0 5px" }}
        >
          {block.number && <span style={{ marginRight: "10px" }}>{block.number}</span>}
          {block.text}
        </h3>
      );

    case "paragraph":
      return (
        <p key={key} {...breakAttr} style={text}>
          <Runs runs={block.runs} />
        </p>
      );

    case "bullets":
      return (
        <ul key={key} style={{ listStyle: "none", margin: "0 0 6px", padding: 0 }}>
          {block.items.map((item, index) => (
            <li
              key={index}
              {...(index === 0 ? breakAttr : { "data-amc-break": "" })}
              style={{ ...text, position: "relative", paddingLeft: "22px", margin: "0 0 3px" }}
            >
              <span style={{ position: "absolute", left: "6px", color: AMC_DOC_COLORS.brand }}>•</span>
              <Runs runs={item} />
            </li>
          ))}
        </ul>
      );

    case "lettered":
      return (
        <div key={key} style={{ margin: "0 0 6px" }}>
          {block.items.map((item, index) => (
            <p
              key={item.letter}
              {...(index === 0 ? breakAttr : { "data-amc-break": "" })}
              style={{ ...text, position: "relative", paddingLeft: "22px", margin: "0 0 3px" }}
            >
              <span style={{ position: "absolute", left: 0, fontWeight: 700 }}>{item.letter}</span>
              <Runs runs={item.runs} />
            </p>
          ))}
        </div>
      );

    case "term":
      return (
        <p key={key} {...breakAttr} style={{ ...text, position: "relative", paddingLeft: "38px" }}>
          <span style={{ position: "absolute", left: 0, fontWeight: 700, color: AMC_DOC_COLORS.brand }}>{block.number}</span>
          <Runs runs={block.runs} />
        </p>
      );

    case "signatures":
      return (
        <div key={key} {...breakAttr} style={{ display: "flex", gap: "40px", marginTop: "28px" }}>
          {[block.left, block.right].map((party) => (
            <div key={party} style={{ flex: 1 }}>
              <div style={{ ...text, fontSize: pt(AMC_DOC_PT.small), color: AMC_DOC_COLORS.muted }}>{party}</div>
              <div style={{ height: "56px", borderBottom: `1px solid ${AMC_DOC_COLORS.muted}` }} />
              <div style={{ ...text, fontSize: pt(8), color: AMC_DOC_COLORS.muted, marginTop: "4px" }}>
                Name / Signature / Stamp
              </div>
            </div>
          ))}
        </div>
      );
  }
}

export function AmcDocumentBody({ model }: { model: AmcDocumentModel }) {
  const pdf = useContext(AmcPdfRenderContext);
  return (
    <div data-amc-body style={{ width: "100%", fontFamily: AMC_DOC_FONT, color: AMC_DOC_COLORS.text }}>
      {model.blocks.map((block, index) => {
        const previous = model.blocks[index - 1];
        const keep = previous?.kind === "heading" || previous?.kind === "subheading" || previous?.kind === "label";
        return renderBlock(block, index, keep, pdf);
      })}
    </div>
  );
}
