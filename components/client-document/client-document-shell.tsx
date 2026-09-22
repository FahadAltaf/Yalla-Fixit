"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Download, FileText, FileType2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { AMC_BRAND_IMAGES, AMC_PAGE } from "@/components/dashboard/extensions/amc/templates/amc-doc/amc-doc-theme";

/**
 * The page a client sees when we send them a document: an AMC proposal or
 * contract (/amc/[token]), a snagging quotation (/quote/[token]) or a
 * quotation from Zoho (/quotations/review). One shell, so the three look
 * like they come from the same company:
 *
 *   - a sticky navbar with the logo and the page's actions, so the answer
 *     stays one tap away however far down the document the client reads;
 *   - the facts a client checks first, in one strip;
 *   - the document itself, sized to exactly the width of that strip.
 */

export type ClientFact = { label: string; value: string; hint?: string | null };

export function ClientDocumentShell({
  actions,
  facts,
  children,
}: {
  actions: ReactNode;
  facts: ClientFact[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-[858px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img
            src={AMC_BRAND_IMAGES.logoTrimmed}
            alt="Yalla Fix It Facility Management"
            className="h-12 w-auto shrink-0 self-start object-contain sm:h-14 sm:self-auto"
          />
          <div className="flex gap-2">{actions}</div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[858px] flex-col gap-5 px-4 py-6">
        {facts.length > 0 && (
          <section
            className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))` }}
          >
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0 bg-white px-4 py-3">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{fact.label}</p>
                <p className="mt-1 truncate font-semibold text-slate-900 tabular-nums">{fact.value}</p>
                {fact.hint && <p className="mt-0.5 truncate text-xs text-slate-500">{fact.hint}</p>}
              </div>
            ))}
          </section>
        )}

        {children}

        <p className="pb-4 text-center text-xs text-slate-500">
          Questions? Call 800-PERFECT (7373328) or reply to the email we sent you.
        </p>
      </main>
    </div>
  );
}

/**
 * A fixed-width A4 document, zoomed to exactly the width of its column:
 * up on a wide page, so it lines up with the cards above it; down on a
 * phone, so there is no sideways scrolling and the client can pinch closer.
 */
export function FitToWidth({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => setZoom(frame.clientWidth / AMC_PAGE.width);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className="flex w-full justify-center">
      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200" style={{ zoom }}>
        {children}
      </div>
    </div>
  );
}

export function formatClientDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export type ClientFileFormat = "pdf" | "docx";

/**
 * Download, as PDF (to read and keep) or Word (to mark up). The caller
 * builds the file; this owns the menu, the spinner and the failure notice.
 */
export function ClientDownloadMenu({
  onDownload,
  disabled,
}: {
  onDownload: (format: ClientFileFormat) => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (format: ClientFileFormat) => {
    setBusy(true);
    try {
      await onDownload(format);
    } catch (error) {
      console.error(error);
      toast.error("The file could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy || disabled} aria-label="Download">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          <span className="hidden lg:inline">{busy ? "Preparing…" : "Download"}</span>
          <ChevronDown className="hidden size-3.5 opacity-60 lg:inline" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run("pdf")}>
          <FileText className="size-4" /> PDF document
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("docx")}>
          <FileType2 className="size-4" /> Word document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
