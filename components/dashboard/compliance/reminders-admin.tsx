"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BellRing, Paperclip, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { complianceService, type ReminderRow } from "@/modules/compliance";
import { ITEM_STATUS_LABEL } from "@/lib/compliance/statuses";
import { StatusPill, formatDateOnly } from "./status-pill";
import { useComplianceRights } from "./use-rights";

const STATUS_OPTIONS = ["expired", "due_30", "due_60", "due_90", "missing_expiry"] as const;
const ACTION_CLASS: Record<string, string> = {
  "Renew Immediately": "text-danger font-medium",
  "Start Renewal Now": "text-danger",
  "Prepare Documents": "text-warning",
  "Plan Renewal": "text-brand",
  "Enter expiry date": "text-warning",
};

/**
 * Expiry reminder list (FRD FR-7): every Due, Expired or Missing-expiry
 * item for active manpower, derived from the records, so it can neither
 * break nor miss anyone.
 */
export default function RemindersAdmin() {
  const params = useSearchParams();
  const { rights } = useComplianceRights();
  const [item, setItem] = useState(params.get("item") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [site, setSite] = useState(params.get("site") ?? "");
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [sites, setSites] = useState<{ id: string; label: string }[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Numbered loads: a response from a superseded request is dropped (same race as the employees list).
  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await complianceService.reminders({ item, status, site });
      if (seq !== requestSeq.current) return;
      setRows(result.rows);
      setAsOf(result.as_of);
      // The site options come from an unfiltered load, so narrowing never hides a site.
      if (!item && !status && !site) {
        const seen = new Map<string, string>();
        result.rows.forEach((r) => {
          if (r.site_client_id && r.site_label) seen.set(r.site_client_id, r.site_label.split(" · ")[0]);
        });
        setSites([...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)));
      }
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : "Could not load the reminder list");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [item, status, site]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Manpower compliance"
        title="Expiry reminders"
        description={asOf ? `Everything due, expired or missing a date for active staff, as of ${formatDateOnly(asOf)}. Sorted by days remaining.` : "Everything due, expired or missing a date for active staff."}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select value={item || "all"} onValueChange={(v) => setItem(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48" id="reminders-item-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            <SelectItem value="emirates_id">Emirates ID</SelectItem>
            <SelectItem value="passport">Passport</SelectItem>
            <SelectItem value="certificates">Training certificates</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48" id="reminders-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {ITEM_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={site || "all"} onValueChange={(v) => setSite(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56" id="reminders-site-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sites</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} retrying={loading} />
      ) : loading ? (
        <ListSkeleton />
      ) : !rows.length ? (
        <EmptyState icon={<BellRing className="size-5" />} title="Nothing needs action" description={item || status || site ? "No items match these filters." : "Every document and certificate for active staff is valid for more than 90 days."} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Expiry date</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.employee_id}:${r.item_key}`}>
                  <TableCell>
                    <Link href={`/compliance/employees/${r.employee_id}`} className="font-medium hover:underline">
                      {r.full_name}
                    </Link>
                    <div className="text-muted-foreground text-xs">{r.maher_id}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.site_label ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell className="text-sm">
                    {r.item_label}
                    {r.has_document && rights.full_numbers ? (
                      <Link href={`/compliance/employees/${r.employee_id}#doc-${r.item_key}`} className="text-brand ml-2 inline-flex items-center gap-1 text-xs hover:underline" title="Open the attached file on the record">
                        <Paperclip className="size-3.5" /> File
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{formatDateOnly(r.expiry)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{r.days === null ? "—" : r.days}</TableCell>
                  <TableCell>
                    <StatusPill status={r.status} />
                  </TableCell>
                  <TableCell className={`text-sm ${ACTION_CLASS[r.action] ?? ""}`}>{r.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
