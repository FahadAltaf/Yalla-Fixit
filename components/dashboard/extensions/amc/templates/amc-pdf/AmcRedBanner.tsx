import { AMC_PDF_STYLES } from "./amc-pdf-styles";

interface Props {
  title: string;
}

export function AmcRedBanner({ title }: Props) {
  return (
    <div
      style={{
        backgroundColor: AMC_PDF_STYLES.BRAND_RED,
        color: "#ffffff",
        fontWeight: 700,
        fontSize: "14px",
        padding: "5px 8px",
        marginBottom: "8px",
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        paddingBottom: "10px",
      }}
    >
      {title}
    </div>
  );
}
