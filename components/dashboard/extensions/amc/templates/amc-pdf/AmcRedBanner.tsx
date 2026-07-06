import { AMC_PDF_STYLES, PDF_EXTRA_PADDING_BOTTOM } from "./amc-pdf-styles";

interface Props {
  title: string;
  isPdf?: boolean;
}

export function AmcRedBanner({ title, isPdf = false }: Props) {
  return (
    <div
      style={{
        backgroundColor: AMC_PDF_STYLES.BRAND_RED,
        color: "#ffffff",
        fontSize: "16px",
        marginBottom: "8px",
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        marginTop: "20px",
        paddingLeft: "12px",
        paddingRight: "12px",
        fontWeight: 300,
        ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
      }}
    >
      {title}
    </div>
  );
}
