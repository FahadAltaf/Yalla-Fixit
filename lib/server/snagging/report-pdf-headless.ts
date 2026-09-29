import fs from "node:fs";
import type { Browser } from "puppeteer-core";

/**
 * Server-side PDF rendering (FR-7.01).
 *
 * The client report has to be produced automatically when an inspection is
 * approved, which rules out the browser-side html2canvas path the portal
 * uses for on-demand downloads: that needs somebody to have the page open.
 * A headless Chrome prints the same HTML with no session involved.
 *
 * `puppeteer-core` rather than `puppeteer`: no bundled Chromium download in
 * the repo or the deploy image, and the binary is chosen per environment.
 * Set PUPPETEER_EXECUTABLE_PATH to pin one; otherwise the usual install
 * locations are tried.
 */

const NAV_TIMEOUT_MS = 60_000;
const PDF_TIMEOUT_MS = 120_000;

/** Where Chrome usually lives, per platform, when nothing is configured. */
const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean) as string[];

export class BrowserUnavailableError extends Error {
  constructor() {
    super(
      "No Chrome or Chromium executable was found. Set PUPPETEER_EXECUTABLE_PATH to the browser binary.",
    );
    this.name = "BrowserUnavailableError";
  }
}

/** The first candidate that actually exists on this machine. */
export function resolveBrowserPath(): string | null {
  for (const candidate of CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // An unreadable path is simply not a candidate.
    }
  }
  return null;
}

/**
 * Loads the driver at runtime, without the bundler tracing it.
 *
 * The module graph is the problem here, not the import style. Turbopack
 * externalises a Node package by symlinking it under `.next`, and creating
 * a symlink on Windows needs a privilege a standard, non-elevated account
 * does not hold — the link fails with os error 1314, so every route that
 * can reach this file fails to COMPILE. Approving an inspection returned a
 * 500 from the dev overlay having never run the handler. Naming the package
 * in `serverExternalPackages` only makes it worse: "external" is exactly
 * what asks for the symlink.
 *
 * The ignore comments are the supported way to say "leave this import
 * alone": the specifier stays a plain string that Node resolves itself at
 * call time, and no bundler records a dependency on it. Assembling the
 * specifier instead does NOT work — Turbopack cannot analyse it and
 * replaces the call with a stub that throws "Cannot find module as
 * expression is too dynamic".
 *
 * The type is still checked, through the `import type` above, which the
 * compiler erases before any bundler sees it.
 *
 * Deployment note: because nothing traces this, `puppeteer-core` has to be
 * present in node_modules at runtime. It is a normal dependency, so an
 * ordinary install covers it; a standalone build would need it added to
 * `outputFileTracingIncludes`.
 */
async function loadPuppeteer(): Promise<typeof import("puppeteer-core").default> {
  const mod = await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ "puppeteer-core"
  );
  return (mod.default ?? mod) as typeof import("puppeteer-core").default;
}

export type PdfRenderResult = {
  pdf: Buffer;
  /** Wall-clock milliseconds, for the FR-7.01 budget. */
  durationMs: number;
  pageCount: number;
};

/**
 * How many reports may be rendering at once, process-wide.
 *
 * Each render is a whole Chrome -- roughly 300MB while it holds a report
 * with photos. Nothing bounded this: approval renders inside `after()`,
 * which defers the work but does not limit it, and the report-versions
 * route calls it inline. Ten simultaneous approvals meant ten Chromes on
 * one long-running host, and the OOM killer takes the entire server with
 * every in-flight request on it.
 *
 * Two is deliberately conservative; raise it against measured host memory,
 * not optimism.
 */
const MAX_CONCURRENT_RENDERS = Number(process.env.REPORT_RENDER_CONCURRENCY) || 2;

/**
 * How long a render may WAIT for a slot before giving up.
 *
 * A queue with no ceiling is just a slower way to fall over: requests pile
 * up holding sockets until the proxy times them out anyway. Failing here is
 * recoverable -- the caller reports it and the report can be generated
 * again -- whereas an exhausted host is not.
 */
const RENDER_QUEUE_TIMEOUT_MS = 90_000;

let activeRenders = 0;
const renderQueue: Array<() => void> = [];

export class RenderBusyError extends Error {
  constructor() {
    super(
      "The server is already generating as many reports as it can at once. Try again in a moment.",
    );
    this.name = "RenderBusyError";
  }
}

/** Runs `work` with a render slot held, releasing it whatever happens. */
async function withRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = renderQueue.indexOf(admit);
        if (at !== -1) renderQueue.splice(at, 1);
        reject(new RenderBusyError());
      }, RENDER_QUEUE_TIMEOUT_MS);

      function admit() {
        clearTimeout(timer);
        resolve();
      }

      renderQueue.push(admit);
    });
  }

  activeRenders += 1;
  try {
    return await work();
  } finally {
    activeRenders -= 1;
    renderQueue.shift()?.();
  }
}

/**
 * Prints one HTML document to an A4 PDF.
 *
 * The browser is always closed -- success, thrown error or timeout -- because
 * a leaked Chrome on a server holds hundreds of megabytes until the process
 * dies.
 */
export async function renderPdfFromHtml(html: string): Promise<PdfRenderResult> {
  // The executable check is outside the gate: a host with no browser should
  // fail immediately rather than queue for a slot it can never use.
  const executablePath = resolveBrowserPath();
  if (!executablePath) throw new BrowserUnavailableError();

  return withRenderSlot(() => renderWithBrowser(html, executablePath));
}

async function renderWithBrowser(
  html: string,
  executablePath: string,
): Promise<PdfRenderResult> {
  const started = Date.now();
  const puppeteer = await loadPuppeteer();

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        // Chrome's default /dev/shm is 64MB in most containers, which a
        // report with two hundred photos will exhaust mid-render.
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    // The document carries its own styles and signed image URLs; setContent
    // waits for the network to settle so no photo prints as a blank box.
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: NAV_TIMEOUT_MS,
    });

    // Backgrounds are load-bearing here: severity chips and the marked-spot
    // overlay are colour, and Chrome drops them from print by default.
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: PDF_TIMEOUT_MS,
      margin: { top: "10mm", right: "8mm", bottom: "12mm", left: "8mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `
        <div style="width:100%;font-size:7px;color:#8b8f93;text-align:center;padding:0 8mm;">
          <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>`,
    });

    const buffer = Buffer.from(pdf);
    return {
      pdf: buffer,
      durationMs: Date.now() - started,
      // Cheap and good enough for a record of size; the PDF is the artefact.
      pageCount: (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length,
    };
  } finally {
    // close() rather than disconnect(): the process is ours to end.
    if (browser) {
      await browser.close().catch((closeError) => {
        console.error("Headless browser close failed:", closeError);
      });
    }
  }
}
