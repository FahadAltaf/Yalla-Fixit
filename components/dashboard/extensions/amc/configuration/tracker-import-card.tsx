"use client";

import { useMemo, useState } from "react";
import { CircleAlert, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { executeRESTBackend } from "@/lib/rest-server";
import type { trackerSummary } from "@/lib/amc/tracker-import";
import type { ImportPreview, ImportPreviewRow, ImportResult } from "@/lib/server/amc/tracker-import";
import { cn } from "@/lib/utils";

type Preview = ImportPreview & { summary: ReturnType<typeof trackerSummary>; problems: string[] };

const STATUS_PILL: Record<ImportPreviewRow["status"], string> = {
  active: "bg-success/10 text-success",
  expired: "bg-muted text-muted-foreground",
  upcoming: "bg-brand/10 text-brand",
};
const PAGE = 15;
const BATCH = 8;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** The tracker as text: Excel saves CSV in Windows-1252 unless asked for UTF-8. */
async function readTracker(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * DEV-486 (26 Nov 2026): the department's contract tracker, imported once.
 * Pick the CSV, look at what would be made (nothing is written), choose who
 * each handler is in the portal, then import. Contracts go in small batches,
 * oldest first; one already imported is skipped, so a second run is safe.
 * The portal only: no Zoho FSM record and no message to any client.
 */
export function TrackerImportCard({ canImport }: { canImport: boolean }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [filter, setFilter] = useState<"all" | "issues" | "new">("all");
  const [page, setPage] = useState(0);
  const { confirm, dialog } = useConfirm();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setResults(null);
    setError(null);
    const text = await readTracker(file);
    setCsv(text);
    await runPreview(text);
  };

  const runPreview = async (text: string) => {
    setBusy("preview");
    setError(null);
    try {
      const p = await executeRESTBackend<Preview>("/api/amc-import/tracker", { method: "POST", body: { csv: text, mode: "preview" } });
      setPreview(p);
      setOwners(Object.fromEntries(p.handlers.filter((h) => h.suggestedUserId).map((h) => [h.handler, h.suggestedUserId as string])));
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setBusy(null);
    }
  };

  const toImport = preview ? preview.rows.filter((r) => !r.alreadyImported).length : 0;

  const runImport = () =>
    void confirm({
      title: `Import ${toImport} contracts?`,
      description:
        "They are written to the portal with their clients, addresses and visits. Nothing goes to Zoho FSM and no client is messaged. Contracts already imported are skipped.",
      confirmText: "Import",
    }).then(async (ok) => {
      if (!ok || !csv || !preview) return;
      setBusy("import");
      setResults([]);
      const all: ImportResult[] = [];
      let from: number | null = 0;
      try {
        while (from !== null) {
          const r: { results: ImportResult[]; next: number | null; total: number } = await executeRESTBackend("/api/amc-import/tracker", {
            method: "POST",
            body: { csv, mode: "import", from, count: BATCH, owners },
          });
          all.push(...r.results);
          setResults([...all]);
          setProgress({ done: r.next ?? r.total, total: r.total });
          from = r.next;
        }
        const failed = all.filter((r) => r.outcome === "failed").length;
        if (failed) toast.error(`${failed} contract(s) could not be imported; see the list.`);
        else toast.success(`Imported ${all.filter((r) => r.outcome === "imported").length} contracts.`);
        await runPreview(csv);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "The import stopped; run it again to carry on (imported contracts are skipped).");
      } finally {
        setBusy(null);
      }
    });

  const rows = useMemo(() => {
    const list = preview?.rows ?? [];
    return filter === "issues" ? list.filter((r) => r.issues.length) : filter === "new" ? list.filter((r) => !r.alreadyImported) : list;
  }, [preview, filter]);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const s = preview?.summary;

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <SectionCard
        icon={<FileSpreadsheet />}
        title="Import contracts from the tracker"
        description="DEV-486: the department's AMC tracker (current and expired contracts), saved as CSV. You see what would be made before anything is written."
        bodyClassName="px-5 pb-5"
      >
        <div className="grid gap-4">
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
            <li>Clients keep the Customer ID the tracker shows; an existing portal client (same ID, email or name) is reused.</li>
            <li>Visit dates before today are imported as done, later ones as planned; a running contract gets the rest of its term planned, never a past visit left open.</li>
            <li>Visits dated before a contract starts go on the term before it, which the newer contract renews.</li>
            <li>No instalments (the payment terms are kept as words), no Zoho FSM records, no client messages.</li>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Input type="file" accept=".csv,text/csv" className="max-w-sm" disabled={!canImport || busy !== null} onChange={(e) => void pick(e.target.files?.[0])} aria-label="Tracker CSV" />
            {fileName ? <span className="text-muted-foreground text-sm">{fileName}</span> : null}
            {csv && !busy ? (
              <Button variant="outline" size="sm" onClick={() => void runPreview(csv)}>
                Read again
              </Button>
            ) : null}
          </div>
          {!canImport ? <p className="text-muted-foreground text-sm">Importing needs AMC Configuration (Edit).</p> : null}
          {busy === "preview" ? <p className="text-muted-foreground text-sm">Reading the file and the portal…</p> : null}
        </div>
      </SectionCard>

      {error ? <ErrorState title="Could not read the tracker" message={error} onRetry={csv ? () => void runPreview(csv) : undefined} /> : null}

      {preview && s ? (
        <>
          <StatCardGrid columns={4}>
            <StatCard label="Contracts" value={s.contracts} headline={`${s.fromFile} rows · ${s.earlierTerms} earlier terms made`} />
            <StatCard label="Running / ended" value={`${s.active + s.upcoming} / ${s.expired}`} headline={`${s.renewals} linked as renewals`} />
            <StatCard label="Visits" value={s.visitsDone} headline={`done · ${s.visitsPlanned} dated later in the file`} />
            <StatCard label="To import" value={toImport} headline={`${preview.rows.length - toImport} already imported`} tone={toImport ? "neutral" : "good"} />
          </StatCardGrid>

          {preview.problems.length ? (
            <Alert variant="warning">
              <CircleAlert />
              <AlertTitle>{preview.problems.length} row(s) left out</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {preview.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <SectionCard title="Who each handler is" description="Each contract's coordinator in the portal: reminders and to-dos go to them. Unmatched handlers fall to you." bodyClassName="border-t">
            <div className="divide-y">
              {preview.handlers.map((h) => (
                <div key={h.handler} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium">{h.handler}</p>
                    <p className="text-muted-foreground text-sm">{h.contracts} contracts</p>
                  </div>
                  <Select value={owners[h.handler] ?? ""} onValueChange={(v) => setOwners((o) => ({ ...o, [h.handler]: v }))}>
                    <SelectTrigger className="w-64" aria-label={`Portal user for ${h.handler}`}>
                      <SelectValue placeholder="You (the importer)" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.people.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="What will be made"
            description="One row per contract, oldest first when imported."
            bodyClassName="border-t"
            action={
              <div className="bg-muted inline-flex items-center gap-0.5 rounded-full p-1 text-sm" role="tablist" aria-label="Show">
                {(
                  [
                    ["all", `All (${preview.rows.length})`],
                    ["issues", `With notes (${preview.rows.filter((r) => r.issues.length).length})`],
                    ["new", `To import (${toImport})`],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={filter === v}
                    onClick={() => {
                      setFilter(v);
                      setPage(0);
                    }}
                    className={cn("rounded-full px-3 py-1 font-medium whitespace-nowrap", filter === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b">
                    <th className="px-5 py-2.5 font-medium">Client</th>
                    <th className="px-3 py-2.5 font-medium">Term</th>
                    <th className="px-3 py-2.5 font-medium">Visits</th>
                    <th className="px-3 py-2.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((r) => (
                    <tr key={r.index} className="align-top">
                      <td className="max-w-80 px-5 py-3">
                        <p className="font-medium">{r.customerName}</p>
                        <p className="text-muted-foreground">{[r.customerRef ?? "No Customer ID", r.client === "existing" ? "existing client" : "new client"].join(" · ")}</p>
                        <p className="text-muted-foreground truncate">{r.property}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <p>
                          {day(r.startDate)} to {day(r.endDate)}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="secondary" className={cn("rounded-full border-0", STATUS_PILL[r.status])}>
                            {r.status === "upcoming" ? "Starts later" : r.status === "active" ? "Running" : "Ended"}
                          </Badge>
                          {r.synthesized ? <Badge variant="outline">Earlier term</Badge> : null}
                          {r.alreadyImported ? <Badge variant="outline">Imported</Badge> : null}
                        </div>
                        {r.renews ? <p className="text-muted-foreground mt-1 text-xs">Renews {r.renews}</p> : null}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <p>{r.visitsDone} done</p>
                        <p className="text-muted-foreground text-xs">{r.services} services · {r.handler ?? "no handler"}</p>
                      </td>
                      <td className="text-muted-foreground max-w-md px-3 py-3 text-xs">{r.issues.length ? <ul className="grid list-disc gap-0.5 pl-4">{r.issues.map((i) => <li key={i}>{i}</li>)}</ul> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm">
              <span className="text-muted-foreground">
                Showing {rows.length ? page * PAGE + 1 : 0} to {Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </SectionCard>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {progress && busy === "import" ? (
              <div className="flex min-w-64 items-center gap-3">
                <Progress value={(progress.done / Math.max(1, progress.total)) * 100} className="h-2" />
                <span className="text-muted-foreground text-sm tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              </div>
            ) : null}
            <SubmitButton onClick={runImport} pending={busy === "import"} pendingLabel="Importing…" disabled={!canImport || busy !== null || toImport === 0} icon={<Upload className="size-4" />}>
              Import {toImport} contracts
            </SubmitButton>
          </div>

          {results && results.length ? (
            <SectionCard title="Import results" description="Imported, skipped (already in the portal) or failed, with why." bodyClassName="border-t">
              <ul className="divide-y text-sm">
                {results
                  .filter((r) => r.outcome !== "imported" || results.length <= 30)
                  .map((r) => (
                    <li key={`${r.index}-${r.outcome}`} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5">
                      <span>
                        <span className="font-medium">{r.customerName}</span> <span className="text-muted-foreground">({r.source})</span>
                        <span className="text-muted-foreground block text-xs">{r.message}</span>
                      </span>
                      <Badge variant="secondary" className={cn("rounded-full border-0", r.outcome === "imported" ? "bg-success/10 text-success" : r.outcome === "failed" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground")}>
                        {r.outcome === "imported" ? "Imported" : r.outcome === "failed" ? "Failed" : "Skipped"}
                      </Badge>
                    </li>
                  ))}
              </ul>
              <p className="text-muted-foreground border-t px-5 py-3 text-sm">
                {results.filter((r) => r.outcome === "imported").length} imported · {results.filter((r) => r.outcome === "skipped").length} skipped · {results.filter((r) => r.outcome === "failed").length} failed
              </p>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
