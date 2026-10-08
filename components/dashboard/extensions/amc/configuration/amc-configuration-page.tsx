"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { History, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { DataRow, PageHeading, PillTabs, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, FieldsSkeleton, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/context/AuthContext";
import type { AmcConfig, AmcConfigSection } from "@/lib/amc/config";
import type { AmcTemplatesConfig } from "@/lib/amc/message-templates";
import { amcPlatformService, type AmcConfigResponse } from "@/modules/amc-platform/amc-platform-service";

import { CONFIG_VIEWS, SECTION_DEFS, type ConfigView } from "./config-fields";
import { RolesAndJobs } from "./roles-jobs";
import { ConfigSectionForm } from "./section-form";
import { TemplatesEditor } from "./templates-editor";

/**
 * AMC configuration (DEV-419): the values the business changes without a
 * release (BRD 5.5, 5.8, 5.10, 5.11, 5.16, 6.7), the email and message
 * texts, the AMC roles and the scheduled jobs. Laid out like AMC Settings:
 * one view per area, kept in ?view=, and a change history.
 */
export function AmcConfigurationPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AmcConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const viewParam = searchParams.get("view");
  const view: ConfigView = CONFIG_VIEWS.some((v) => v.value === viewParam) ? (viewParam as ConfigView) : "approvals";
  const setView = (next: ConfigView) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  /* Bumped to load again (Retry, and after every save). */
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  useEffect(() => {
    let gone = false;
    amcPlatformService
      .getConfig()
      .then((response) => {
        if (gone) return;
        setData(response);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!gone) setError(e instanceof Error ? e.message : "Could not load AMC configuration");
      });
    return () => {
      gone = true;
    };
  }, [reloadKey]);

  const save = useCallback(
    async <K extends AmcConfigSection>(section: K, value: AmcConfig[K]) => {
      try {
        const result = await amcPlatformService.saveConfigSection(section, value);
        toast.success(result.changed ? "Saved." : "Nothing had changed.");
        load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save");
        throw e;
      }
    },
    [load],
  );

  const isAdmin = userProfile?.roles?.name === "admin";
  const sections = useMemo(() => {
    const names: readonly string[] = CONFIG_VIEWS.find((v) => v.value === view)?.sections ?? [];
    return SECTION_DEFS.filter((d) => names.includes(d.section));
  }, [view]);

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <Heading />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <HeadingSkeleton />
        <SectionSkeleton>
          <FieldsSkeleton />
        </SectionSkeleton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Heading />

      {!data.migrated ? (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>Showing the defaults</AlertTitle>
          <AlertDescription>
            The Phase 1 database update (20261007110000) has not been applied yet, so nothing can be saved. The values below are the defaults every AMC screen uses until then.
          </AlertDescription>
        </Alert>
      ) : null}
      {data.invalid.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Some saved values no longer fit</AlertTitle>
          <AlertDescription>
            {data.invalid.join(", ")}: the defaults are in use. Save the section again to replace them.
          </AlertDescription>
        </Alert>
      ) : null}

      <PillTabs<ConfigView>
        value={view}
        onChange={setView}
        tabs={CONFIG_VIEWS.map((v) => ({
          value: v.value,
          label: v.label,
          count: v.value === "history" ? data.history.length : undefined,
        }))}
      />

      {sections.map((def) => (
        <ConfigSectionForm
          key={def.section}
          def={def}
          value={data.config[def.section]}
          defaults={data.defaults[def.section]}
          canEdit={data.canEdit[def.section]}
          migrated={data.migrated}
          users={data.users}
          onSave={(value) => save(def.section, value as never)}
        />
      ))}

      {view === "templates" ? (
        <TemplatesEditor
          saved={data.config.templates as AmcTemplatesConfig}
          canEdit={data.canEdit.templates}
          migrated={data.migrated}
          onSave={(value) => save("templates", value)}
        />
      ) : null}

      {view === "roles" ? <RolesAndJobs isAdmin={isAdmin} canRunJobs={data.canEdit.proposals && data.migrated} /> : null}

      {view === "history" ? <ConfigHistory data={data} /> : null}
    </div>
  );
}

function Heading() {
  return (
    <PageHeading
      eyebrow="Configuration"
      title="AMC configuration"
      description="Approval ladder, payment bands, pipeline, schedule, service levels, renewals, the email and message texts, the AMC roles and the scheduled jobs. Changes apply from the next action; every change is recorded."
    />
  );
}

const SECTION_TITLES: Record<string, string> = {
  ...Object.fromEntries(SECTION_DEFS.map((d) => [d.section, d.title])),
  templates: "Emails and messages",
};

function show(value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (Array.isArray(value)) return value.length > 4 ? `${value.length} items` : value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") || "none";
  if (typeof value === "object") return "changed";
  return String(value);
}

function ConfigHistory({ data }: { data: AmcConfigResponse }) {
  return (
    <SectionCard icon={<History />} title="Change history" description="Who changed what, when, with the old and new values (BRD 5.3, 6.9)." bodyClassName="border-t">
      {data.history.length === 0 ? (
        <EmptyState icon={<History />} title="No changes yet" description="Every section shows its default until someone saves it." />
      ) : (
        <ul className="divide-y">
          {data.history.map((h) => (
            <li key={h.id}>
              <DataRow
                icon={<History />}
                title={SECTION_TITLES[h.section] ?? h.section}
                subtitle={h.actorLabel ?? "Someone"}
                trailing={<span className="text-muted-foreground text-xs tabular-nums">{timeAgo(h.createdAt)}</span>}
              />
              {/* Indented under the title, past the icon tile, so each change reads as part of its row. */}
              <ul className="text-muted-foreground -mt-1 space-y-0.5 pr-5 pb-3 pl-17 text-xs">
                {h.changes.map((c) => (
                  <li key={c.field}>
                    {c.field}: {show(c.before)} → {show(c.after)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
