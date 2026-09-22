/**
 * Splitting the AMC document body into A4 pages.
 *
 * The body is measured once on an off-screen page (AmcDocumentMeasure).
 * Each page then shows the body through a window. Pages used to be cut at a
 * fixed height, which could slice a line of text or a table row in half
 * across two pages. Now every page ends at the last place the body may
 * break — the top of a paragraph, list item or table row that fits — and
 * only falls back to a hard cut when a single element is taller than a page.
 */

export function computeBodySliceOffsets(
  bodyHeight: number,
  viewportHeight: number,
  breakPoints: number[] = [],
  /* A page is never cut shorter than this to reach a break. */
  minSliceHeight = viewportHeight * 0.4,
): number[] {
  if (bodyHeight <= 0 || viewportHeight <= 0) return [0];

  const breaks = [...new Set(breakPoints.map((y) => Math.round(y)))].sort((a, b) => a - b);
  const offsets: number[] = [0];
  let start = 0;

  while (start + viewportHeight < bodyHeight - 2) {
    const limit = start + viewportHeight;
    let next = limit;
    for (const y of breaks) {
      if (y > limit) break;
      if (y >= start + minSliceHeight) next = y;
    }
    offsets.push(next);
    start = next;
  }

  return offsets;
}

export function measureAmcLayoutHeights(container: HTMLElement) {
  const pageEl = container.querySelector<HTMLElement>("[data-amc-measure-page]");
  const headerEl = pageEl?.querySelector<HTMLElement>("[data-amc-header]");
  const footerEl = pageEl?.querySelector<HTMLElement>("[data-amc-footer]");
  const bodyEl = pageEl?.querySelector<HTMLElement>("[data-amc-body]");

  if (!pageEl || !headerEl || !footerEl || !bodyEl) {
    throw new Error("AMC measurement elements not found.");
  }

  const pageStyle = window.getComputedStyle(pageEl);
  const headerStyle = window.getComputedStyle(headerEl);
  const paddingTop = parseFloat(pageStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(pageStyle.paddingBottom) || 0;
  const headerHeight = headerEl.offsetHeight + (parseFloat(headerStyle.marginBottom) || 0);

  const viewportHeight = Math.max(
    100,
    pageEl.offsetHeight - paddingTop - paddingBottom - headerHeight - footerEl.offsetHeight - 8,
  );

  /* Where a page may start: the top of every element marked as a break,
     relative to the body. */
  const bodyTop = bodyEl.getBoundingClientRect().top;
  const breakPoints = Array.from(bodyEl.querySelectorAll<HTMLElement>("[data-amc-break]")).map(
    (el) => el.getBoundingClientRect().top - bodyTop,
  );

  return { bodyHeight: bodyEl.offsetHeight, viewportHeight, breakPoints };
}
