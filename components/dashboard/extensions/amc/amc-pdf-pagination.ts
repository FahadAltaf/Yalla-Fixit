export function computeBodySliceOffsets(
  bodyHeight: number,
  viewportHeight: number,
  minSliceHeight = 120
): number[] {
  if (bodyHeight <= 0 || viewportHeight <= 0) {
    return [0];
  }

  const offsets: number[] = [0];
  let y = 0;

  while (y + viewportHeight < bodyHeight - 4) {
    y += viewportHeight;
    offsets.push(y);
    if (bodyHeight - y < minSliceHeight) {
      break;
    }
  }

  return offsets;
}

export function measureAmcLayoutHeights(container: HTMLElement) {
  const headerEl = container.querySelector<HTMLElement>("[data-amc-measure-header]");
  const bodyEl = container.querySelector<HTMLElement>("[data-amc-body]");
  const footerEl = container.querySelector<HTMLElement>("[data-amc-measure-footer]");
  const pageEl = container.querySelector<HTMLElement>("[data-amc-measure-page]");

  if (!headerEl || !bodyEl || !footerEl || !pageEl) {
    throw new Error("AMC measurement elements not found.");
  }

  const pageHeight = pageEl.offsetHeight;
  const pageStyle = window.getComputedStyle(pageEl);
  const paddingTop = parseFloat(pageStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(pageStyle.paddingBottom) || 0;
  const headerHeight = headerEl.offsetHeight;
  const footerHeight = footerEl.offsetHeight;
  const bodyHeight = bodyEl.offsetHeight;

  const viewportHeight = Math.max(
    100,
    pageHeight - paddingTop - paddingBottom - headerHeight - footerHeight
  );

  return { bodyHeight, viewportHeight };
}
