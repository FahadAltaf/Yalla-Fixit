/**
 * One colour vocabulary for every chart on the snagging pages.
 *
 * Two rules, and they are the whole system:
 *
 *   1. Data that carries no judgement is drawn in the neutral end of the
 *      ramp. Most data carries no judgement.
 *   2. Colour means one of three things — needs attention, in flight, or
 *      done — and nothing else. A hue is never spent on making a chart
 *      look less plain.
 *
 * Every value is a token. Nothing here is a literal, so a tenant that
 * rethemes the app rethemes the charts with it, and the semantic three
 * stay put because they mean the same thing under any brand.
 */
export const CHART_COLOR = {
  /** The brand end of the ramp: one series, or the leading bar. */
  brand: "var(--chart-1)",
  /** A lighter step of the same hue, for a second related series. */
  brandSoft: "var(--chart-2)",
  brandSofter: "var(--chart-3)",
  /** The neutral end: informational data, and anything not being judged. */
  neutral: "var(--chart-4)",
  neutralSoft: "var(--chart-5)",

  /** Needs attention: high severity, rejected, late. */
  attention: "var(--color-danger)",
  /** In flight: in progress, medium priority, waiting on somebody. */
  progress: "var(--color-warning)",
  /** Landed well: completed, approved, verified. */
  good: "var(--color-success)",
} as const;

/**
 * A stage's colour in a pipeline.
 *
 * Read as a journey rather than as a set of alerts: nothing yet started
 * is neutral, work in flight is amber, work moving through review runs
 * up the brand ramp, and the two end states are green because arriving
 * is the good outcome. Six stages, six distinguishable colours, and none
 * of them arbitrary.
 */
export const PIPELINE_COLOR: Record<string, string> = {
  assigned: CHART_COLOR.neutralSoft,
  in_progress: CHART_COLOR.progress,
  submitted: CHART_COLOR.brandSofter,
  in_review: CHART_COLOR.brandSoft,
  approved: CHART_COLOR.good,
  delivered: CHART_COLOR.brand,
};

/**
 * Severity, escalating.
 *
 * The one place on these pages where colour is doing the primary work,
 * so it climbs: neutral, amber, red. Both the arc and its legend swatch
 * read from here, which is what keeps them in step.
 */
export const SEVERITY_COLOR: Record<string, string> = {
  high: CHART_COLOR.attention,
  medium: CHART_COLOR.progress,
  low: CHART_COLOR.neutralSoft,
};

/**
 * The quotation funnel.
 *
 * Raised and sent are steps, not verdicts, so they stay neutral. Only
 * the three outcomes take a colour — approved is the win, rejected is
 * the loss, awaiting is the one still costing somebody time.
 */
export const QUOTATION_COLOR: Record<string, string> = {
  generated: CHART_COLOR.neutral,
  sent: CHART_COLOR.neutralSoft,
  approved: CHART_COLOR.good,
  rejected: CHART_COLOR.attention,
  awaiting: CHART_COLOR.progress,
};
