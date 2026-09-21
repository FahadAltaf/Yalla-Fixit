"use client";

import { useEffect } from "react";

/**
 * Re-reads the report's dates in the viewer's own time zone.
 *
 * The report is rendered on the server, which cannot know where the reader
 * is, so it prints UAE dates inside `<time data-local-date>` tags carrying
 * the instant. Once the page is in the browser those are rewritten here.
 */
export function LocalDates() {
  useEffect(() => {
    const format = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    document.querySelectorAll<HTMLTimeElement>("time[data-local-date]").forEach((node) => {
      const at = new Date(node.dateTime);
      if (!Number.isNaN(at.getTime())) node.textContent = format.format(at);
    });
  }, []);
  return null;
}
