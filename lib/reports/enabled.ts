/**
 * The Reports module: the Reports menu and pages, My compliance, and
 * Settings → Reporting. Hidden unless NEXT_PUBLIC_REPORTS_ENABLED=on
 * (2 Nov): main goes live with Finance first, Reports later, without a
 * code change. NEXT_PUBLIC so the menu (in the browser) and the pages (on
 * the server) read the same value; like every NEXT_PUBLIC_ variable it is
 * fixed when the app is built, so a change needs a rebuild (or a restart
 * of `next dev`).
 */
export const REPORTS_ENABLED = process.env.NEXT_PUBLIC_REPORTS_ENABLED === "on";
