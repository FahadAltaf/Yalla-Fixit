"use client";

import { ExternalLink, FileText, Loader2, RotateCw } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SnaggingReportVersion } from "@/modules/snagging";

/*
  A render takes seconds. One still pending after this long was cut off --
  the approving manager closed the page before the PDF was saved -- and
  needs making again.
*/
const STUCK_AFTER_MS = 10 * 60 * 1000;

function pdfState(version: SnaggingReportVersion): "ready" | "working" | "stuck" | "failed" {
  if (version.pdf_url || version.generation_status === "generated") return "ready";
  if (version.generation_status === "failed") return "failed";
  const age = Date.now() - new Date(version.generated_at).getTime();
  return age > STUCK_AFTER_MS ? "stuck" : "working";
}

const PDF_STATE: Record<ReturnType<typeof pdfState>, { label: string; tone: string }> = {
  ready: { label: "Saved", tone: "bg-success/10 text-success" },
  working: { label: "Saving", tone: "bg-brand/10 text-brand" },
  stuck: { label: "Not saved", tone: "bg-warning/10 text-warning" },
  failed: { label: "Failed", tone: "bg-destructive/10 text-destructive" },
};

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

/**
 * The client's report, version by version (report versioning).
 *
 * The client holds one report. Each approved additional visit that adds
 * snags reissues it as the next version, and every earlier version stays
 * here with the PDF that was actually saved and sent, so "which snags were
 * in the copy the client has" always has an answer.
 */
export function ReportVersionsCard({
  versions,
  canSave,
  saving,
  onSave,
}: {
  versions: SnaggingReportVersion[];
  /* May make the newest version's missing PDF from this page. */
  canSave: boolean;
  /* The version whose PDF is being made, if any. */
  saving: string | null;
  onSave: (version: SnaggingReportVersion) => void;
}) {
  if (versions.length === 0) return null;
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  const newestId = newestFirst[0]?.id;

  return (
    <SectionCard
      title="Report versions"
      icon={<FileText />}
      description="The client holds one report. An additional visit that adds snags reissues it as the next version; earlier versions stay available here."
      bodyClassName="border-t"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 ps-5">Version</TableHead>
              <TableHead className="h-10">Issued for</TableHead>
              <TableHead className="h-10 ">Snags</TableHead>
              <TableHead className="h-10">Issued</TableHead>
              <TableHead className="h-10 pe-5 ">PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {newestFirst.map((version) => {
              const state = pdfState(version);
              /*
                Only the newest can be made again: the PDF is drawn from the
                report as it stands, which is the newest version's content
                and nobody else's.
              */
              const canMake = canSave && version.id === newestId && state !== "ready";
              return (
                <TableRow key={version.id}>
                  <TableCell className="ps-5">
                    <span className="flex items-center gap-2 font-medium">
                      V{version.version}
                      {version.is_current ? (
                        <Badge
                          variant="secondary"
                          className="bg-success/10 text-success rounded-sm border-none font-medium"
                        >
                          Current
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {version.reason ?? (version.version === 1 ? "Inspection approved" : "—")}
                  </TableCell>
                  <TableCell className=" tabular-nums">{version.snag_count}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {fmtDate(version.generated_at)}
                  </TableCell>
                  <TableCell className="pe-5">
                    <div className="flex flex-wrap items-center gap-2">
                      {version.pdf_url ? (
                        <Button asChild size="sm" variant="outline" className="h-7">
                          <a href={version.pdf_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-3.5" />
                            Open
                          </a>
                        </Button>
                      ) : (
                        <Badge
                          variant="secondary"
                          className={cn("gap-1 rounded-sm border-none font-medium", PDF_STATE[state].tone)}
                        >
                          {state === "working" ? <Loader2 className="size-3 animate-spin" /> : null}
                          {PDF_STATE[state].label}
                        </Badge>
                      )}
                      {canMake ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={saving !== null}
                          onClick={() => onSave(version)}
                        >
                          {saving === version.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCw className="size-3.5" />
                          )}
                          {saving === version.id ? "Saving…" : "Save PDF"}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </SectionCard>
  );
}
