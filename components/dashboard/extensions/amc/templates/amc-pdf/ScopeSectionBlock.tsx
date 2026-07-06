import type { ScopeSectionContent } from "../../amc-contract-content";
import {
  clauseBulletItem,
  clauseParagraph,
  CLAUSE_LAYOUT,
  highlightStyle,
} from "./amc-pdf-styles";

interface Props {
  section: ScopeSectionContent;
  isPdf?: boolean;
}

export function ScopeSectionBlock({ section, isPdf = false }: Props) {
  return (
    <div style={{ marginBottom: CLAUSE_LAYOUT.SECTION_GAP }}>
      <div
        style={{
          ...clauseParagraph,
          fontWeight: 700,
          display: "inline",
          padding: "1px 2px",
          marginLeft: CLAUSE_LAYOUT.SUB_SECTION_INDENT,
          ...highlightStyle(isPdf),
        }}
      >
        {section.sectionNumber} {section.title}
      </div>
      {section.intro && (
        <div style={{ ...clauseParagraph, marginTop: "4px", whiteSpace: "pre-line" }}>
          {section.intro}
        </div>
      )}
      <ul style={{ margin: "4px 0 0 0", padding: 0, listStyle: "none" }}>
        {section.bullets.map((bullet) => (
          <li key={bullet} style={clauseBulletItem}>
            <span style={{ position: "absolute", left: "44px" }}>-</span>
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}
