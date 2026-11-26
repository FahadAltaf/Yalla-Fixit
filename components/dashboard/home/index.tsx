"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  CircleCheckBig,
  ClipboardCheck,
  Contact,
  FileSignature,
  Gavel,
  ListTodo,
  ReceiptText,
  RefreshCw,
  Shield,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { HomeNotificationsPanel } from "@/components/dashboard/notifications/home-notifications-panel";
import { DataRow, PageHeading, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { HOME_MODULE_LABELS, greeting, type HomeItem, type HomeModule, type HomeSummary } from "@/lib/home/summary";
import { executeRESTBackend } from "@/lib/rest-server";
import { cn } from "@/lib/utils";

import { HomeChartCard } from "./home-chart";
import { HomeDrillDialog, TONE_PILL } from "./home-drill-dialog";

const MODULE_ICONS: Record<HomeModule, LucideIcon> = {
  amc: FileSignature,
  snagging: ClipboardCheck,
  scheduling: CalendarDays,
  invoicing: ReceiptText,
  compliance: BadgeCheck,
  todos: ListTodo,
  workforce: UsersRound,
  clients: Contact,
  admin: Shield,
};

const todayLabel = () => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }).format(new Date());
const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const number = (n: number) => n.toLocaleString("en-AE");

/* A health tile says how it is, not a bare zero. */
const healthValue = (item: HomeItem) =>
  item.key === "users" ? number(item.count) : item.tone === "good" ? "Healthy" : item.count ? `${number(item.count)} to check` : "Check";

/**
 * The home page: the one page every signed-in user has (26 Nov 2026, the
 * user: "update dashboard of portal according to approver, admin, role
 * based user"; then "add charts, and when click on stats open popup with
 * proper pagination, then click on it then show their page").
 *
 * It shows what is waiting on this person across the whole portal, and only
 * what they may open:
 *
 *   Waiting for your decision   their approvals, anywhere in the portal
 *   Your work                   what is assigned to them or in their queue
 *   Charts                      the modules they can open, at a glance
 *   Notifications               unread, until opened (BRD 6.2)
 *   Portal health               administrators only
 *   Across the portal           one figure per module they can open
 *
 * Every figure, row and bar opens its records in a popup (paged and
 * searched on the server); each record opens its own page.
 */
export default function HomeDashboard() {
  const { userProfile } = useAuth();
  const name = userProfile?.first_name?.trim() || userProfile?.full_name?.trim()?.split(" ")[0];
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<{ key: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await executeRESTBackend<HomeSummary>("/api/home"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openItem = (item: HomeItem) => setDrill({ key: item.key, title: item.title });

  const role = summary?.role;
  const roleLine = role ? [role.isAdmin ? "Administrator" : role.name ? titleCase(role.name) : null, role.isApprover ? "Approver" : null].filter(Boolean).join(" · ") : null;
  const nothingWaiting = summary !== null && summary.approvals.length === 0 && summary.work.length === 0;
  const approvalsTotal = summary?.approvals.reduce((s, i) => s + i.count, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow={todayLabel()}
        title={`${greeting()}${name ? `, ${name}` : ""}`}
        description={roleLine ? `${roleLine}. What is waiting for you across the portal.` : "What is waiting for you across the portal."}
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error && !summary ? <ErrorState title="Could not load your dashboard" message={error} onRetry={() => void load()} /> : null}
      {!summary && !error ? <HomeSkeleton /> : null}

      {summary ? (
        <>
          {summary.approvals.length ? (
            <SectionCard icon={<Gavel />} title={`Waiting for your decision (${number(approvalsTotal)})`} description="Approvals that are yours to give. Open one to see the records." bodyClassName="border-t">
              <ul className="divide-y">
                {summary.approvals.map((item) => {
                  const Icon = MODULE_ICONS[item.module];
                  return (
                    <li key={item.key}>
                      <DataRow
                        onClick={() => openItem(item)}
                        icon={<Icon />}
                        title={item.title}
                        subtitle={[HOME_MODULE_LABELS[item.module], item.detail].filter(Boolean).join(" · ")}
                        trailing={
                          <span className="flex items-center gap-2">
                            <Badge variant="secondary" className={cn("min-w-7 justify-center rounded-full border-0 px-2 font-semibold tabular-nums", TONE_PILL[item.tone])}>
                              {number(item.count)}
                            </Badge>
                            <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                          </span>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          ) : null}

          {summary.work.length ? (
            <Section title="Your work">
              <StatCardGrid columns={summary.work.length >= 4 ? 4 : 3}>
                {summary.work.map((item) => (
                  <StatCard
                    key={item.key}
                    label={item.title}
                    value={number(item.count)}
                    headline={item.detail ?? HOME_MODULE_LABELS[item.module]}
                    tone={item.tone}
                    onSelect={() => openItem(item)}
                    selectLabel={`${item.title}: show the ${number(item.count)} records`}
                  />
                ))}
              </StatCardGrid>
            </Section>
          ) : null}

          {nothingWaiting ? (
            <Card className="flex flex-row items-center gap-4 p-5">
              <span className="bg-success/10 text-success flex size-10 shrink-0 items-center justify-center rounded-full">
                <CircleCheckBig className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">Nothing is waiting for you</p>
                <p className="text-muted-foreground text-sm">
                  No approvals and nothing assigned to you right now.{summary.overview.length ? " The modules you can open are below." : " Pick a module from the sidebar to get started."}
                </p>
              </div>
            </Card>
          ) : null}

          {summary.charts.length ? (
            <Section title="At a glance">
              <div className={cn("grid gap-6", summary.charts.length > 1 && "@4xl/main:grid-cols-2")}>
                {summary.charts.map((chart) => {
                  const Icon = MODULE_ICONS[chart.module];
                  return (
                    <HomeChartCard
                      key={chart.key}
                      chart={chart}
                      icon={<Icon />}
                      onSelect={(point) => (point.drill ? setDrill({ key: point.drill, title: `${chart.title}: ${point.label}` }) : undefined)}
                    />
                  );
                })}
              </div>
            </Section>
          ) : null}

          <HomeNotificationsPanel />

          {summary.admin ? (
            <Section title="Portal health" hint="For administrators">
              <StatCardGrid columns={3}>
                {summary.admin.map((item) => (
                  <StatCard key={item.key} label={item.title} value={healthValue(item)} headline={item.detail ?? undefined} tone={item.tone} onSelect={() => openItem(item)} selectLabel={`${item.title}: show the details`} />
                ))}
              </StatCardGrid>
            </Section>
          ) : null}

          {summary.overview.length ? (
            <Section title="Across the portal">
              <StatCardGrid columns={summary.overview.length >= 4 ? 4 : 3}>
                {summary.overview.map((item) => (
                  <StatCard
                    key={item.key}
                    label={`${HOME_MODULE_LABELS[item.module]} · ${item.title}`}
                    value={number(item.count)}
                    headline={item.detail ?? undefined}
                    tone={item.tone}
                    onSelect={() => openItem(item)}
                    selectLabel={`${item.title}: show the records`}
                  />
                ))}
              </StatCardGrid>
            </Section>
          ) : null}

          {summary.unavailable.length ? <p className="text-muted-foreground text-xs">Not shown this time (could not be read): {summary.unavailable.join(", ")}. Refresh to try again.</p> : null}
        </>
      ) : null}

      <HomeDrillDialog drillKey={drill?.key ?? null} fallbackTitle={drill?.title} onClose={() => setDrill(null)} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="flex items-baseline gap-2 text-sm font-medium">
        <span>{title}</span>
        {hint ? <span className="text-muted-foreground text-xs font-normal">{hint}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading your dashboard">
      <Card className="gap-0 p-0">
        <div className="flex items-center gap-3 p-5">
          <Skeleton className="size-9 rounded-md" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 border-t px-5 py-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
        ))}
      </Card>
      <div className="grid gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="gap-3 p-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-4 w-40" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 @4xl/main:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="gap-4 p-5">
            <Skeleton className="h-5 w-48" />
            {[70, 45, 85, 30, 55].map((w, j) => (
              <div key={j} className="flex items-center gap-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5" style={{ width: `${w}%` }} />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
