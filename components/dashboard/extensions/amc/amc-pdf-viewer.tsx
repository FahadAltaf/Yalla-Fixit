"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FileType,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * In-page viewer for AMC proposals and contracts.
 *
 * Replaces opening the PDF in a new tab. That approach fought the browser at
 * every step: a tab opened after the PDF finished rendering was silently
 * killed by the popup blocker, and a tab opened up front sat on
 * about:blank ("Preparing your document…") when the hand-off to the PDF
 * did not land. Rendering the PDF inside the page sidesteps all of it — no
 * popup to block, and the team never leaves the proposal they are working on.
 *
 * Download and Open in new tab are still offered, but only once the PDF
 * exists. A click on either is then a direct, immediate response to the
 * user, which browsers always allow.
 */

type ViewerState =
  | { status: "closed" }
  | { status: "loading"; title: string }
  | { status: "ready"; title: string; url: string; filename: string; buildWord?: () => Promise<BuiltPdf> }
  | { status: "error"; title: string; message: string };

export type BuiltPdf = { blob: Blob; filename: string };

/* The same document as an editable Word file, offered beside the PDF. */
export type OpenOptions = { buildWord?: () => Promise<BuiltPdf> };

export function useAmcPdfViewer(
  /* The line under the title once the PDF is showing. The team is told
     what the client will get; the client page says something else. */
  { readyNote = "This is exactly what the client will receive." }: { readyNote?: string } = {},
) {
  const [state, setState] = useState<ViewerState>({ status: "closed" });

  /*
    Each open() takes a ticket. A render that finishes after the viewer was
    closed, or after another document was opened, holds a stale ticket and
    is discarded — otherwise a slow contract could replace the proposal the
    user has since switched to.
  */
  const ticketRef = useRef(0);
  /* What the last open() was asked to build, so Try again can rebuild it. */
  const lastRequestRef = useRef<{
    title: string;
    build: () => Promise<BuiltPdf>;
    options?: OpenOptions;
  } | null>(null);

  const open = useCallback(
    async (title: string, build: () => Promise<BuiltPdf>, options?: OpenOptions): Promise<void> => {
      const ticket = ++ticketRef.current;
      lastRequestRef.current = { title, build, options };
      setState({ status: "loading", title });
      try {
        const { blob, filename } = await build();
        if (ticket !== ticketRef.current) return;
        setState({
          status: "ready",
          title,
          url: URL.createObjectURL(blob),
          filename,
          buildWord: options?.buildWord,
        });
      } catch (error) {
        if (ticket !== ticketRef.current) return;
        console.error(error);
        setState({
          status: "error",
          title,
          message:
            error instanceof Error && error.message
              ? error.message
              : "The document could not be built.",
        });
      }
    },
    [],
  );

  /* Declared after open(), not inside it: a callback that refers to itself
     from its own initializer reads a variable before it exists. */
  const retry = useCallback(() => {
    const last = lastRequestRef.current;
    if (last) void open(last.title, last.build, last.options);
  }, [open]);

  const close = useCallback(() => {
    ticketRef.current += 1;
    setState({ status: "closed" });
  }, []);

  /* Release the PDF's memory whenever it stops being shown. */
  const readyUrl = state.status === "ready" ? state.url : null;
  useEffect(() => {
    if (!readyUrl) return;
    return () => URL.revokeObjectURL(readyUrl);
  }, [readyUrl]);

  const viewer = (
    <AmcPdfViewerDialog
      state={state}
      onClose={close}
      onRetry={retry}
      readyNote={readyNote}
    />
  );

  return { open, close, viewer, isBusy: state.status === "loading" };
}

function AmcPdfViewerDialog({
  state,
  onClose,
  onRetry,
  readyNote,
}: {
  state: ViewerState;
  onClose: () => void;
  onRetry: () => void;
  readyNote: string;
}) {
  const isOpen = state.status !== "closed";
  const title = state.status === "closed" ? "" : state.title;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[90vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b px-5 py-3 pr-12 text-left">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="text-xs">
              {state.status === "loading" && "Building the PDF…"}
              {state.status === "ready" && readyNote}
              {state.status === "error" && "The document could not be built."}
            </DialogDescription>
          </div>

          {state.status === "ready" && (
            <div className="flex shrink-0 items-center gap-2">
              <DownloadMenu url={state.url} filename={state.filename} buildWord={state.buildWord} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(state.url, "_blank", "noopener")}
              >
                <ExternalLink className="size-4" />
                Open in new tab
              </Button>
            </div>
          )}
        </DialogHeader>

        <div className="bg-muted/40 relative min-h-0 flex-1">
          {state.status === "loading" && <LoadingPage />}

          {state.status === "ready" && (
            <iframe
              /* FitH opens the PDF at page width, which is how it is read. */
              src={`${state.url}#view=FitH`}
              title={state.title}
              className="h-full w-full border-0"
            />
          )}

          {state.status === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <TriangleAlert className="text-destructive size-8" />
              <p className="font-medium">Couldn&apos;t build this document</p>
              <p className="text-muted-foreground max-w-md text-sm">{state.message}</p>
              <Button onClick={onRetry} size="sm">
                <RotateCcw className="size-4" />
                Try again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/*
  One Download menu, PDF or Word, like the review step and the other
  document screens. The PDF is already built; the Word file is built on
  demand, since most people only ever want the PDF.
*/
function DownloadMenu({
  url,
  filename,
  buildWord,
}: {
  url: string;
  filename: string;
  buildWord?: () => Promise<BuiltPdf>;
}) {
  const [busy, setBusy] = useState(false);

  const downloadPdf = useCallback(() => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  }, [url, filename]);

  const downloadWord = useCallback(async () => {
    if (!buildWord) return;
    setBusy(true);
    try {
      const { blob, filename: wordName } = await buildWord();
      saveAs(blob, wordName);
    } catch (error) {
      console.error(error);
      toast.error("Couldn't create the Word file. Try again.");
    } finally {
      setBusy(false);
    }
  }, [buildWord]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {busy ? "Preparing…" : "Download"}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={downloadPdf}>
          <FileText className="size-4" />
          PDF
        </DropdownMenuItem>
        {buildWord && (
          <DropdownMenuItem onClick={() => void downloadWord()}>
            <FileType className="size-4" />
            Word (.docx)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* A page-shaped placeholder, so the wait reads as "a document is coming"
   rather than as a blank dialog. */
function LoadingPage() {
  return (
    <div className="flex h-full items-start justify-center overflow-hidden p-6">
      <div className="bg-background flex aspect-[1/1.414] w-full max-w-xl flex-col gap-4 rounded-md border p-8 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="bg-muted h-8 w-32 animate-pulse rounded" />
          <div className="bg-muted h-8 w-20 animate-pulse rounded" />
        </div>
        <div className="bg-muted h-px w-full" />
        <div className="bg-muted h-5 w-3/5 animate-pulse rounded" />
        <div className="bg-muted h-24 w-full animate-pulse rounded" />
        <div className="bg-muted h-4 w-2/5 animate-pulse rounded" />
        <div className="bg-muted h-32 w-full animate-pulse rounded" />
        <div className="text-muted-foreground mt-auto flex items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          <FileText className="size-4" />
          Preparing the document. Longer contracts take a few seconds.
        </div>
      </div>
    </div>
  );
}
