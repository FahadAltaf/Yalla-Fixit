import type { ScopeSectionContent } from "../../amc-contract-content";
import { AMC_PDF_STYLES, bodyText } from "./amc-pdf-styles";

interface Props {
  section: ScopeSectionContent;
}

export function ScopeSectionBlock({ section }: Props) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          ...bodyText,
          fontWeight: 700,
          backgroundColor: AMC_PDF_STYLES.HIGHLIGHT_YELLOW,
          display: "inline",
          padding: "1px 2px",
        }}
      >
        {section.sectionNumber} {section.title}
      </div>
      {section.intro && (
        <div style={{ ...bodyText, marginTop: "4px", whiteSpace: "pre-line" }}>
          {section.intro}
        </div>
      )}
      <ul style={{ margin: "4px 0 0 0", paddingLeft: "14px", listStyle: "none" }}>
        {section.bullets.map((bullet) => (
          <li
            key={bullet}
            style={{
              ...bodyText,
              marginBottom: "2px",
              position: "relative",
              paddingLeft: "8px",
            }}
          >
            <span style={{ position: "absolute", left: 0 }}>-</span>
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}
