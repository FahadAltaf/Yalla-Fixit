/**
 * Neutralises colour values html2canvas 1.x cannot parse — the modern CSS
 * colour functions (oklch / oklab / lab / lch / color()) that Tailwind v4 emits
 * on inherited properties. Runs against the *clone* html2canvas builds (via its
 * `onclone` hook), and only rewrites a property when its computed value is one
 * of those functions, so explicit hex/rgb colours in the document are untouched.
 *
 * Shared by every html2canvas → jsPDF path (snagging reports, quotation PDFs)
 * so a single fix covers them all.
 */
export function sanitizeUnsupportedColors(clonedDoc: Document): void {
  const bad = /(oklch|oklab|lab\(|lch\(|color\()/i;
  const win = clonedDoc.defaultView;
  if (!win) return;

  const fallbacks: Record<string, string> = {
    color: "#1f2937",
    "background-color": "transparent",
    "border-top-color": "#d9d2cc",
    "border-right-color": "#d9d2cc",
    "border-bottom-color": "#d9d2cc",
    "border-left-color": "#d9d2cc",
    "outline-color": "transparent",
    "text-decoration-color": "currentColor",
    fill: "#1f2937",
    stroke: "#1f2937",
  };

  clonedDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = win.getComputedStyle(el);
    for (const prop of Object.keys(fallbacks)) {
      const v = cs.getPropertyValue(prop);
      if (v && bad.test(v)) el.style.setProperty(prop, fallbacks[prop], "important");
    }
    const shadow = cs.getPropertyValue("box-shadow");
    if (shadow && bad.test(shadow)) el.style.setProperty("box-shadow", "none", "important");
    const bg = cs.getPropertyValue("background-image");
    if (bg && bad.test(bg)) el.style.setProperty("background-image", "none", "important");
  });
}
