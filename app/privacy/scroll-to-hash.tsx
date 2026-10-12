"use client";

import { useEffect } from "react";

/**
 * Re-applies the #hash jump after the app has finished rendering.
 *
 * The browser does scroll to the anchor on load -- and then the page is
 * re-rendered on the client once the session resolves, which puts it
 * back at the top. The result is a link that lands on the right page at
 * the wrong place, and the reader has to hunt for the section they asked
 * for. Google Play follows one of these links (the data-deletion URL in
 * the Data safety form), so it has to work.
 *
 * Twice: once on mount, and once a frame later for the re-render that
 * caused the problem. Both are no-ops when there is no hash.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace("#", ""));
    if (!id) return;

    const jump = () => {
      const target = document.getElementById(id);
      if (!target) return;
      /* Honours scroll-mt on the target, so it does not sit at the very
         edge of the viewport. */
      target.scrollIntoView({ block: "start", behavior: "auto" });
    };

    jump();
    const settled = window.setTimeout(jump, 250);
    return () => window.clearTimeout(settled);
  }, []);

  return null;
}
