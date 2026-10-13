"use client";

import Link from "next/link";
import { Camera, ClipboardList, Siren } from "lucide-react";

import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CallOutStatus } from "@/lib/amc/call-outs";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { clientHistoryService, type AssetHistory } from "@/modules/amc-contracts/client-history-service";

import { CallOutStatusBadge } from "../call-out-shared";
import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";

/* The job sheet's check results (job-sheet-panel.tsx), the same words and tints. */
const CHECK_LABELS: Record<string, string> = { ok: "OK", attention: "Needs attention", fault: "Fault", not_applicable: "Not applicable" };
const CHECK_TONE: Record<string, string> = {
  ok: "bg-success/10 text-success",
  attention: "bg-warning/10 text-warning",
  fault: "bg-danger/10 text-danger",
  not_applicable: "bg-mist text-ink-soft",
};
const PHOTO_LABELS: Record<string, string> = { before: "Before", after: "After", fault: "Fault", other: "Other" };

const tradeLabel = (trade: string) => TRADE_LABELS[trade as keyof typeof TRADE_LABELS] ?? trade;

/** One asset's service history (BRD 5.2): its checklist results and photos from job sheets, and call outs for its trade. */
export function AssetHistoryDialog({
  open,
  onOpenChange,
  propertyId,
  asset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  /** Kept while the dialog closes, so the body does not blank out. */
  asset: { id: string; assetType: string; trade: string; location: string | null } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>History of {asset?.assetType ?? "this asset"}</DialogTitle>
          <DialogDescription>
            {asset ? [tradeLabel(asset.trade), asset.location].filter(Boolean).join(" · ") : ""}
            {asset ? ". " : ""}
            Checks and photos recorded against it on job sheets, and the call outs at this property for its trade.
          </DialogDescription>
        </DialogHeader>
        {asset ? <AssetHistoryBody propertyId={propertyId} assetId={asset.id} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span className="text-brand [&_svg]:size-4">{icon}</span>
        {title}
        {count ? <span className="text-muted-foreground text-xs font-normal tabular-nums">({count})</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground rounded-md border border-dashed px-4 py-3 text-sm">{children}</p>;
}

function AssetHistoryBody({ propertyId, assetId }: { propertyId: string; assetId: string }) {
  const { data, error, loading, reload } = useAmcData(() => clientHistoryService.asset(propertyId, assetId), `asset-history|${propertyId}|${assetId}`);

  if (error) return <ErrorState title="Could not load the asset's history" message={error} onRetry={reload} />;
  if (loading || !data) return <ListSkeleton rows={4} className="rounded-md border" />;
  return (
    <div className="grid gap-6 py-1">
      <ChecksSection checks={data.checks} />
      <PhotosSection photos={data.photos} />
      <CallOutsSection callOuts={data.callOuts} trade={data.asset.trade} />
    </div>
  );
}

function ChecksSection({ checks }: { checks: AssetHistory["checks"] }) {
  return (
    <Section icon={<ClipboardList />} title="Checklist results" count={checks.length}>
      {checks.length === 0 ? (
        <Empty>No checks recorded against this asset yet. They come from the job sheet of each visit.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[620px]">
            <TableHeader className="[&_th]:text-muted-foreground">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Visit</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="pr-4">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((c) => (
                <TableRow key={c.id} className="h-12">
                  <TableCell className="pl-4 tabular-nums">{formatContractDate(c.date)}</TableCell>
                  <TableCell className="tabular-nums">
                    {c.contractId && c.visitNo !== null ? (
                      <Link href={`/extensions/amc-contracts/${c.contractId}?tab=schedule${c.visitId ? `&visit=${c.visitId}` : ""}`} className="font-medium hover:underline">
                        Visit {c.visitNo}
                      </Link>
                    ) : c.visitNo !== null ? (
                      `Visit ${c.visitNo}`
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{c.label}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`border-0 font-medium ${CHECK_TONE[c.result] ?? "bg-mist text-ink-soft"}`}>
                      {CHECK_LABELS[c.result] ?? c.result}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[220px] pr-4 text-sm whitespace-normal">{c.note || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

function PhotosSection({ photos }: { photos: AssetHistory["photos"] }) {
  return (
    <Section icon={<Camera />} title="Photos" count={photos.length}>
      {photos.length === 0 ? (
        <Empty>No photos taken of this asset yet.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img src={p.url} alt={p.caption ?? `${PHOTO_LABELS[p.kind] ?? "Asset"} photo`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center text-xs">Unavailable</div>
              )}
              <Badge variant="secondary" className="bg-background/90 text-foreground absolute bottom-1.5 left-1.5 border-0 font-medium">
                {PHOTO_LABELS[p.kind] ?? p.kind}
              </Badge>
              <div className="text-muted-foreground px-2 py-1 text-xs">
                {formatContractDate(p.date)}
                {p.caption ? <span className="block truncate">{p.caption}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function CallOutsSection({ callOuts, trade }: { callOuts: AssetHistory["callOuts"]; trade: string }) {
  return (
    <Section icon={<Siren />} title={`Call outs for ${tradeLabel(trade).toLowerCase()}`} count={callOuts.length}>
      {callOuts.length === 0 ? (
        <Empty>No call outs at this property for this trade. Call outs carry no asset, so they are matched by trade.</Empty>
      ) : (
        <ul className="divide-y rounded-md border">
          {callOuts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <Link href={`/extensions/amc-contracts/call-outs?open=${c.id}`} className="font-medium hover:underline">
                  {c.number}
                </Link>
                <span className="text-muted-foreground"> · {formatContractDate(c.date)}</span>
                <div className="line-clamp-2">{c.issue}</div>
                {c.resolution ? <div className="text-muted-foreground line-clamp-2 text-xs">Resolution: {c.resolution}</div> : null}
              </div>
              <CallOutStatusBadge status={c.status as CallOutStatus} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
