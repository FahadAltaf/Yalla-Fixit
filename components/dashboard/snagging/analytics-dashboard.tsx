"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarIcon, Clock, Download, ThumbsUp, Timer } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingAnalytics } from "@/types/types";

import { PageHeading, SeverityBadge } from "./shared";

/** A shadcn date picker (Popover + Calendar) writing a YYYY-MM-DD string. */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const date = value ? parseISO(value) : undefined;
  return (
    <div className="text-sm">
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("w-40 justify-start text-left font-normal", !date && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-2 size-4" />
            {date ? format(date, "dd MMM yyyy") : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Operational analytics (§6.7) and the KPI targets from §2.3.
 *
 * The KPI row is deliberately first: those four numbers are what the
 * sponsor signed the business case on, and burying them under defect
 * distributions would be answering a question nobody asked first.
 */
export default function SnaggingAnalyticsDashboard() {
  const { userProfile } = useAuth();
  const [data, setData] = useState<SnaggingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const canExport = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EXPORT);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await snaggingService.getAnalytics({ from, to }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load analytics");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  /** FR-7.03 — CSV export of whatever is on screen. */
  function exportCsv() {
    if (!data) return;

    const rows: string[][] = [
      ["Developer quality"],
      ["Developer", "Building", "Units", "Snags", "Snags per unit", "Outstanding"],
      ...data.byDeveloper.map((row) => [
        row.developer_name,
        row.building_name ?? "",
        String(row.unit_count),
        String(row.snag_count),
        String(row.snags_per_unit),
        String(row.outstanding_count),
      ]),
      [],
      ["Defects by element"],
      ["Element", "Count"],
      ...data.byElement.map((row) => [row.element_label, String(row.count)]),
      [],
      ["Inspector activity"],
      ["Inspector", "Inspections", "Snags captured"],
      ...data.byInspector.map((row) => [row.name, String(row.task_count), String(row.snag_count)]),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `snagging-analytics-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalSnags = (data?.bySeverity ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Snagging analytics"
        description="Throughput, quality, and developer performance across the period."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
            {canExport ? (
              <Button variant="outline" onClick={exportCsv} disabled={!data}>
                <Download className="size-4" />
                Export CSV
              </Button>
            ) : null}
          </div>
        }
      />

      {loading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<Timer className="size-4" />}
              label="Avg submit to approval"
              value={
                data.kpis.avgPreparationMinutes === null
                  ? "—"
                  : formatMinutes(data.kpis.avgPreparationMinutes)
              }
              target="Target: under 30 min for a studio or 1BR"
            />
            <KpiCard
              icon={<ThumbsUp className="size-4" />}
              label="First-time approval"
              value={
                data.kpis.firstTimeApprovalRate === null
                  ? "—"
                  : `${data.kpis.firstTimeApprovalRate}%`
              }
              target="Target: above 90%"
              progress={data.kpis.firstTimeApprovalRate ?? undefined}
              good={(data.kpis.firstTimeApprovalRate ?? 0) >= 90}
            />
            <KpiCard
              icon={<Clock className="size-4" />}
              label="Delivered within 24h"
              value={
                data.kpis.deliveredWithinSlaRate === null
                  ? "—"
                  : `${data.kpis.deliveredWithinSlaRate}%`
              }
              target="Target: every report"
              progress={data.kpis.deliveredWithinSlaRate ?? undefined}
              good={(data.kpis.deliveredWithinSlaRate ?? 0) >= 95}
            />
            <KpiCard
              icon={<AlertTriangle className="size-4" />}
              label="Approvals overdue"
              value={String(data.counts.overdueApprovals)}
              target="Past the 48-hour escalation point"
              danger={data.counts.overdueApprovals > 0}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CountCard label="In the field" value={data.counts.open} />
            <CountCard label="Awaiting approval" value={data.counts.pendingApproval} />
            <CountCard label="Approved today" value={data.counts.approvedToday} />
            <CountCard label="Delivered" value={data.counts.delivered} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="font-semibold">Defects by severity</h2>
              <p className="text-muted-foreground mb-4 text-sm">{totalSnags} captured this period</p>
              <div className="space-y-3">
                {data.bySeverity.map((row) => (
                  <div key={row.severity} className="flex items-center gap-3">
                    <div className="w-20">
                      <SeverityBadge severity={row.severity} />
                    </div>
                    <Progress
                      value={totalSnags ? (row.count / totalSnags) * 100 : 0}
                      className="flex-1"
                    />
                    <span className="w-12 text-right text-sm tabular-nums">{row.count}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="font-semibold">Most common elements</h2>
              <p className="text-muted-foreground mb-4 text-sm">
                Where defects cluster across the portfolio
              </p>
              <div className="space-y-2">
                {data.byElement.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nothing captured yet.</p>
                ) : (
                  data.byElement.map((row) => (
                    <div key={row.element_code} className="flex items-center gap-3">
                      <span className="w-32 truncate text-sm">{row.element_label}</span>
                      <Progress
                        value={(row.count / (data.byElement[0]?.count || 1)) * 100}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm tabular-nums">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="p-4">
              <h2 className="font-semibold">Developer quality</h2>
              <p className="text-muted-foreground text-sm">
                Internal view. Snag rate per unit by developer and building.
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Developer</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Snags</TableHead>
                    <TableHead className="text-right">Per unit</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byDeveloper.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                        No inspections recorded against a developer yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.byDeveloper.map((row, index) => (
                      <TableRow key={`${row.developer_name}-${row.building_name ?? ""}-${index}`}>
                        <TableCell className="font-medium">
                          {row.developer_name}
                          {row.building_name ? (
                            <span className="text-muted-foreground block text-xs font-normal">
                              {row.building_name}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.unit_count}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.snag_count}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {row.snags_per_unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.outstanding_count}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="p-4">
              <h2 className="font-semibold">Inspector activity</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inspector</TableHead>
                  <TableHead className="text-right">Inspections</TableHead>
                  <TableHead className="text-right">Snags captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byInspector.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground py-8 text-center">
                      No inspections assigned in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.byInspector.map((row) => (
                    <TableRow key={row.user_id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.task_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.snag_count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  target,
  progress,
  good,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  target: string;
  progress?: number;
  good?: boolean;
  danger?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {icon}
        {label}
      </div>
      <p
        className={
          danger
            ? "mt-2 text-2xl font-semibold text-danger"
            : good
              ? "mt-2 text-2xl font-semibold text-success"
              : "mt-2 text-2xl font-semibold"
        }
      >
        {value}
      </p>
      {progress !== undefined ? <Progress value={progress} className="mt-2" /> : null}
      <p className="text-muted-foreground mt-2 text-xs">{target}</p>
    </Card>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
