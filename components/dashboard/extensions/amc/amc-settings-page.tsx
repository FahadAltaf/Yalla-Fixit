"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Clock,
  FileText,
  History,
  Loader2,
  Phone,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  ShieldAlert,
  TriangleAlert,
  UserCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  amcSettingsService,
  type AmcSettingsHistoryItem,
} from "@/modules/amc-submissions";

import { AMC_SERVICES } from "./amc-constants";
import {
  getAmcSettingsDefaults,
  type AmcSettings,
  type AmcSettingsOverrides,
} from "./amc-settings";

/**
 * AMC Settings (FR6.1–FR6.5).
 *
 * Admin-only. The API enforces that; this page also checks, so a
 * non-admin sees an explanation instead of a form that will 403 on save.
 *
 * Each field shows the live value and is marked Customised when it differs
 * from the shipped default, with a Reset that removes the override rather
 * than pasting the default text in — so the clause goes back to tracking
 * releases instead of being frozen at whatever the default said today.
 *
 * Laid out for the amount of text it holds: four views instead of one long
 * scroll, and the clauses and scopes as a list beside a single editor, so
 * an admin picks the one they mean rather than scrolling past eighteen
 * text boxes to find it.
 */

const CLAUSE_FIELDS = [
  {
    key: "helpdeskScheduling" as const,
    label: "Clause 1.1: Helpdesk and scheduling",
    hint: "The helpdesk and call-back promises. The call centre and account manager lines under it come from each proposal.",
  },
  {
    key: "maintenanceTeam" as const,
    label: "Clause 1.2: Maintenance team",
    hint: "Who the technicians are, what tools they bring, and when job reports are shared.",
  },
  {
    key: "workingHours" as const,
    label: "Clause 1.3: Working hours",
    hint: "When regular and emergency call-outs apply.",
  },
  {
    key: "scopeIntro" as const,
    label: "Clause 2: Scope introduction",
    hint: "The paragraph above the scope of each service.",
  },
  {
    key: "emergencyCallOut" as const,
    label: "Clause 3.1: Emergency call-out",
    hint: "What counts as an emergency and how fast the team responds.",
  },
  {
    key: "nonEmergencyCallOut" as const,
    label: "Clause 3.2: Non-emergency call-out",
    hint: "What a non-emergency visit covers and how it is scheduled.",
  },
  {
    key: "materials" as const,
    label: "Clause 4: Materials, spare parts and labour",
    hint: "Which consumables are covered and which parts are charged.",
  },
  {
    key: "servicesExcluded" as const,
    label: "Clause 5: Services excluded",
    hint: "Work the AMC does not cover.",
  },
  {
    key: "excludedOffer" as const,
    label: "Clause 5: Other services we offer",
    hint: "Printed under the excluded services. The first paragraph introduces the list, the last one is the closing note, and every paragraph between them is a point.",
  },
  {
    key: "priceListIntro" as const,
    label: "Clause 6.2: Price list introduction",
    hint: "Printed when the supply and installation price list is on. The first paragraph is the title.",
  },
  {
    key: "handymanRates" as const,
    label: "Clause 6.3: Extra handyman rates",
    hint: "Printed when the fixed price services section is on. The first paragraph is the title, then one paragraph per rate.",
  },
  {
    key: "generalTerms" as const,
    label: "Clause 7: General terms",
    hint: "One paragraph per term, starting with its number, for example 7.1.",
  },
  {
    key: "bankDetails" as const,
    label: "Clause 7.16: Bank details",
    hint: "One paragraph per row of the bank table, written as Label: value.",
  },
  {
    key: "invoiceTerms" as const,
    label: "Clause 7: Invoices and contract term",
    hint: "Printed after the bank details. The first paragraph follows the annual contract value.",
  },
  {
    key: "termination" as const,
    label: "Clause 8: Termination",
    hint: "The notice period and how refunds work.",
  },
  {
    key: "contractConfirmation" as const,
    label: "Contract: Signature confirmation",
    hint: "The line above the signatures on the contract.",
  },
  {
    key: "proposalNotes" as const,
    label: "Proposal: Important notes",
    hint: "The notes at the end of every proposal, one paragraph per note.",
  },
  {
    key: "proposalAcceptance" as const,
    label: "Proposal: Acceptance statement",
    hint: "The line above the signatures on the proposal.",
  },
];

type AmcUser = { email: string; name: string; isAdmin: boolean };

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/*
  FR5.3: who approves or sends back a submitted proposal, and so its
  contract. Offered: admins and everyone whose role has AMC access; access
  itself is given in role settings, not here.
*/
function ApproversPicker({
  users,
  approvers,
  onChange,
}: {
  users: AmcUser[];
  approvers: string[];
  onChange: (approvers: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = users.filter(
    (user) => !term || user.name.toLowerCase().includes(term) || user.email.includes(term),
  );

  return (
    <SectionCard
      icon={<UserCheck />}
      title="Approvers"
      description="Choose who can approve or send back a proposal after it is submitted for approval. The list shows admins and everyone whose role has AMC access. If nobody is ticked, anyone whose role has the AMC approve permission can approve."
      bodyClassName="px-5 pb-5"
    >
      <div className="relative mb-3">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or email"
          aria-label="Search users"
          className="ps-9"
        />
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nobody has AMC access yet. Give a role the AMC Proposals permission in role settings first.
        </p>
      ) : (
        <ul className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
          {shown.length === 0 ? (
            <li className="text-muted-foreground px-4 py-6 text-center text-sm">Nobody matches that.</li>
          ) : (
            shown.map((user) => {
              const selected = approvers.some((email) => sameEmail(email, user.email));
              return (
                <li key={user.email}>
                  <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-4 py-3">
                    <Checkbox
                      checked={selected}
                      onCheckedChange={(checked) =>
                        onChange(
                          checked === true
                            ? [...approvers.filter((email) => !sameEmail(email, user.email)), user.email]
                            : approvers.filter((email) => !sameEmail(email, user.email)),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{user.name}</span>
                      {user.name !== user.email ? (
                        <span className="text-muted-foreground block truncate text-xs">{user.email}</span>
                      ) : null}
                    </span>
                    {user.isAdmin ? (
                      <Badge variant="outline" className="shrink-0 font-normal">
                        Admin
                      </Badge>
                    ) : null}
                  </label>
                </li>
              );
            })
          )}
        </ul>
      )}

      <p className="text-muted-foreground mt-3 text-xs">
        {approvers.length > 0
          ? `${approvers.length} approver${approvers.length === 1 ? "" : "s"}. Only they can approve and see the approval queue.`
          : "No approvers chosen, so anyone whose role has the AMC approve permission can approve."}
      </p>
    </SectionCard>
  );
}

/* The single-line standard values, after the contact numbers and emails. */
const PROVIDER_TEXT_FIELDS: {
  key: "poBox" | "email" | "address" | "contractType" | "standardResponseTime" | "emergencyResponseTime" | "proposalValidity";
  label: string;
  hint?: string;
  type?: "email";
  wide?: boolean;
}[] = [
  { key: "poBox", label: "P.O. Box" },
  { key: "email", label: "Company email", type: "email" },
  { key: "contractType", label: "Contract type", hint: "Printed in the contract's customer details." },
  { key: "address", label: "Company address", wide: true },
  { key: "standardResponseTime", label: "Standard response time", hint: "Printed in the proposal's commercial offer." },
  { key: "emergencyResponseTime", label: "Emergency response time", hint: "Printed in the proposal's commercial offer." },
  { key: "proposalValidity", label: "Proposal validity", hint: "Printed in the proposal details." },
];

type View = "values" | "clauses" | "scopes" | "approvers" | "history";

function isCustomised(value: string, fallback: string) {
  return value !== fallback;
}

/** The {{placeholders}} a text carries, so a missing one can be flagged. */
function tokensIn(text: string): string[] {
  return [...new Set(text.match(/\{\{\s*\w+\s*\}\}/g) ?? [])];
}

/*
  FR4.3 — two clauses carry placeholders that are filled in per proposal
  from the service table. They look like leftover template junk, which is
  exactly how they would get deleted, so say what they are.
*/
function TokenHint() {
  return (
    <p className="text-muted-foreground text-xs leading-relaxed">
      Text in double braces is filled in for each proposal, so keep it when
      you edit. <code className="bg-muted rounded px-1">{"{{handymanHours}}"}</code>{" "}
      becomes the handyman hours entered, and{" "}
      <code className="bg-muted rounded px-1">{"{{nonEmergencyVisits}}"}</code>{" "}
      the number of free non-emergency visits.{" "}
      <code className="bg-muted rounded px-1">{"{{emergencyCallOuts}}"}</code>{" "}
      and{" "}
      <code className="bg-muted rounded px-1">{"{{nonEmergencyCallOuts}}"}</code>{" "}
      each become a whole line, and are left out when that service is not on
      the proposal.
    </p>
  );
}

export function AmcSettingsPage() {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.roles?.name === "admin";

  const defaults = useMemo(() => getAmcSettingsDefaults(), []);
  const [settings, setSettings] = useState<AmcSettings | null>(null);
  // What the server last returned, so unsaved edits can be told apart.
  const [saved, setSaved] = useState<AmcSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<AmcSettingsHistoryItem[]>([]);
  const [amcUsers, setAmcUsers] = useState<AmcUser[]>([]);
  // The view is kept in the address (?view=clauses), so a reload stays on it.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: View = (["values", "clauses", "scopes", "approvers", "history"] as const).includes(
    viewParam as View,
  )
    ? (viewParam as View)
    : "values";
  const setView = (next: View) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await amcSettingsService.getSettings();
      setSettings(response.settings);
      setSaved(response.settings);
      setHistory(response.history ?? []);
      setAmcUsers(response.amcUsers ?? []);
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
      toast.error(
        error instanceof Error ? error.message : "Couldn't load AMC Settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else setLoading(false);
  }, [isAdmin, load]);

  const patch = (next: Partial<AmcSettings>) =>
    setSettings((current) => (current ? { ...current, ...next } : current));

  /*
    Only what differs from the shipped default is sent. A clause left
    alone stays absent from the override document, so a later release that
    corrects it still reaches this install.
  */
  const buildOverrides = useCallback(
    (current: AmcSettings): AmcSettingsOverrides => {
      const clauses = Object.fromEntries(
        CLAUSE_FIELDS.map(({ key }) => [key, current.clauses[key]]).filter(
          ([key, value]) =>
            isCustomised(
              value as string,
              defaults.clauses[key as keyof AmcSettings["clauses"]],
            ),
        ),
      );

      const serviceScopes = Object.fromEntries(
        Object.entries(current.serviceScopes).filter(([id, text]) =>
          isCustomised(text, defaults.serviceScopes[id] ?? ""),
        ),
      );

      const providerChanged =
        current.provider.contactNo !== defaults.provider.contactNo ||
        current.provider.coordinationEmails.join("|") !==
          defaults.provider.coordinationEmails.join("|") ||
        PROVIDER_TEXT_FIELDS.some(({ key }) => current.provider[key] !== defaults.provider[key]);

      const sameList = (a: string[], b: string[]) =>
        [...a].sort().join("|") === [...b].sort().join("|");
      const approvalChanged = !sameList(current.approval.approvers, defaults.approval.approvers);

      return {
        ...(approvalChanged ? { approval: current.approval } : {}),
        ...(providerChanged ? { provider: current.provider } : {}),
        ...(Object.keys(clauses).length ? { clauses } : {}),
        ...(Object.keys(serviceScopes).length ? { serviceScopes } : {}),
      };
    },
    [defaults],
  );

  const dirty = useMemo(
    () =>
      Boolean(settings && saved) &&
      JSON.stringify(settings) !== JSON.stringify(saved),
    [settings, saved],
  );

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await amcSettingsService.saveSettings(
        buildOverrides(settings),
      );
      setSettings(response.settings);
      setSaved(response.settings);
      if (response.history) setHistory(response.history);
      toast.success(
        response.changedKeys?.length
          ? `Saved. ${response.changedKeys.length} field${response.changedKeys.length === 1 ? "" : "s"} updated. New proposals will use this text.`
          : "Saved. There was nothing to change.",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Couldn't save AMC Settings",
      );
    } finally {
      setSaving(false);
    }
  };

  const heading = (
    <PageHeading
      eyebrow="Settings"
      title="AMC settings"
      description="Standard wording for proposals and contracts. Changes apply to new proposals only."
      actions={
        isAdmin && settings ? (
          <div className="flex items-center gap-3">
            {dirty ? (
              <span className="text-warning flex items-center gap-1.5 text-xs font-medium">
                <span className="bg-warning size-1.5 rounded-full" aria-hidden />
                Unsaved changes
              </span>
            ) : null}
            <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save changes
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title="Administrators only"
          description="Only administrators can change the standard wording used in every proposal and contract. Ask an admin if a clause needs updating."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-32 rounded-full" />
          ))}
        </div>
        <Card className="space-y-4 p-5">
          <Skeleton className="h-5 w-52" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  if (loadFailed || !settings) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title="Couldn't load AMC settings"
          description="Something went wrong on our side. This is usually temporary, so try again in a moment."
          action={{ label: "Try again", onClick: () => void load() }}
        />
      </div>
    );
  }

  const customisedClauses = CLAUSE_FIELDS.filter(({ key }) =>
    isCustomised(settings.clauses[key], defaults.clauses[key]),
  ).length;
  const customisedScopes = AMC_SERVICES.filter((service) =>
    isCustomised(
      settings.serviceScopes[service.id] ?? "",
      defaults.serviceScopes[service.id] ?? "",
    ),
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {heading}

      <PillTabs<View>
        value={view}
        onChange={setView}
        tabs={[
          { value: "values", label: "Standard values" },
          { value: "clauses", label: "Contract clauses", count: CLAUSE_FIELDS.length },
          { value: "scopes", label: "Scope of work", count: AMC_SERVICES.length },
          { value: "approvers", label: "Approvers", count: settings.approval.approvers.length },
          { value: "history", label: "Change history", count: history.length },
        ]}
      />

      {view === "values" ? (
        /* FR6.3 — the last two §8.2 placeholders. Until these are filled
           in, every contract still prints the XXX they shipped with. */
        <SectionCard
          icon={<Phone />}
          title="Standard values"
          description="Contact details, company details and the commitments printed in every proposal and contract."
          bodyClassName="px-5 pb-5"
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="amc-contact-no">Contact numbers</Label>
              <Input
                id="amc-contact-no"
                value={settings.provider.contactNo}
                onChange={(event) =>
                  patch({
                    provider: { ...settings.provider, contactNo: event.target.value },
                  })
                }
              />
              <p className="text-muted-foreground text-xs">
                Type them as they should print, for example two numbers separated by a slash.
              </p>
            </div>
            {settings.provider.coordinationEmails.map((email, index) => (
              <div key={index} className="space-y-1.5">
                <Label htmlFor={`amc-coordination-email-${index}`}>
                  Coordination email {index + 1}
                </Label>
                <Input
                  id={`amc-coordination-email-${index}`}
                  type="email"
                  value={email}
                  onChange={(event) => {
                    const next = [...settings.provider.coordinationEmails];
                    next[index] = event.target.value;
                    patch({
                      provider: { ...settings.provider, coordinationEmails: next },
                    });
                  }}
                />
              </div>
            ))}
            {PROVIDER_TEXT_FIELDS.map((field) => (
              <div
                key={field.key}
                className={cn("space-y-1.5", field.wide && "sm:col-span-2 xl:col-span-3")}
              >
                <Label htmlFor={`amc-provider-${field.key}`}>{field.label}</Label>
                <Input
                  id={`amc-provider-${field.key}`}
                  type={field.type ?? "text"}
                  value={settings.provider[field.key]}
                  onChange={(event) =>
                    patch({ provider: { ...settings.provider, [field.key]: event.target.value } })
                  }
                />
                {field.hint ? <p className="text-muted-foreground text-xs">{field.hint}</p> : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {view === "clauses" ? (
        <TextLibrary
          icon={<FileText />}
          searchable
          title="Contract clauses"
          description={`Clauses you haven't edited keep the standard wording. Once you edit one, your version is used instead. ${customisedClauses} of ${CLAUSE_FIELDS.length} customised.`}
          items={CLAUSE_FIELDS.map(({ key, label, hint }) => ({
            id: key,
            label,
            hint,
            value: settings.clauses[key],
            fallback: defaults.clauses[key],
          }))}
          onChange={(id, text) =>
            patch({ clauses: { ...settings.clauses, [id]: text } })
          }
        />
      ) : null}

      {view === "scopes" ? (
        /* FR6.2 — "the scope of work for each service". */
        <TextLibrary
          icon={<Wrench />}
          title="Service scope of work"
          description={`What each service covers, as it prints in the contract. ${customisedScopes} of ${AMC_SERVICES.length} customised.`}
          searchable
          items={AMC_SERVICES.map((service) => ({
            id: service.id,
            label: service.label,
            hint: service.reference ? `Referenced in ${service.reference}.` : undefined,
            value: settings.serviceScopes[service.id] ?? "",
            fallback: defaults.serviceScopes[service.id] ?? "",
          }))}
          onChange={(id, text) =>
            patch({ serviceScopes: { ...settings.serviceScopes, [id]: text } })
          }
        />
      ) : null}

      {view === "approvers" ? (
        <ApproversPicker
          users={amcUsers}
          approvers={settings.approval.approvers}
          onChange={(approvers) => patch({ approval: { approvers } })}
        />
      ) : null}

      {view === "history" ? <SettingsHistory history={history} /> : null}
    </div>
  );
}

type LibraryItem = {
  id: string;
  label: string;
  hint?: string;
  value: string;
  /** The shipped default, for the Customised mark and Reset. */
  fallback: string;
};

/**
 * A set of long texts as a list beside one editor.
 *
 * The list says which items are customised at a glance; the editor gets
 * the room a clause needs, with its default one click away and a warning
 * when a {{placeholder}} the default carries has been deleted.
 */
function TextLibrary({
  icon,
  title,
  description,
  items,
  onChange,
  searchable,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  items: LibraryItem[];
  onChange: (id: string, text: string) => void;
  searchable?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? items.filter((item) => item.label.toLowerCase().includes(term)) : items;
  }, [items, query]);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  if (!selected) return null;

  const customised = isCustomised(selected.value, selected.fallback);
  const missingTokens = tokensIn(selected.fallback).filter(
    (token) => !selected.value.includes(token),
  );

  return (
    /* overflow-visible: the card normally clips its content for its rounded
       corners, and a clipping parent stops the list below from sticking. */
    <SectionCard
      icon={icon}
      title={title}
      description={description}
      bodyClassName="border-t"
      className="overflow-visible"
    >
      <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* The list. On wide screens it stays in view while a long clause
            scrolls on the right, just below the sticky dashboard header. */}
        <div className="border-b lg:border-r lg:border-b-0">
          <div className="lg:sticky lg:top-24">
            {searchable ? (
              <div className="relative border-b p-3">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search..."
                  aria-label={`Search ${title.toLowerCase()}`}
                  className="ps-9"
                />
              </div>
            ) : null}
            <ul className="max-h-[28rem] overflow-y-auto p-2 lg:max-h-[36rem]">
              {shown.length === 0 ? (
                <li className="text-muted-foreground px-3 py-6 text-center text-sm">
                  Nothing matches that.
                </li>
              ) : (
                shown.map((item) => {
                  const active = item.id === selected.id;
                  const changed = isCustomised(item.value, item.fallback);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "focus-visible:ring-ring flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                          active ? "bg-brand-50 text-brand font-medium" : "hover:bg-muted/60",
                        )}
                      >
                        <span className="min-w-0">{item.label}</span>
                        {changed ? (
                          <span
                            className="bg-warning size-2 shrink-0 rounded-full"
                            title="Customised"
                            aria-label="Customised"
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        {/* The editor */}
        <div className="min-w-0 space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Label htmlFor={`amc-text-${selected.id}`} className="text-base font-semibold">
                {selected.label}
              </Label>
              {selected.hint ? (
                <p className="text-muted-foreground mt-0.5 text-sm">{selected.hint}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {customised ? (
                <>
                  <Badge variant="secondary" className="bg-warning/10 text-warning border-0">
                    Customised
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(selected.id, selected.fallback)}
                  >
                    <RotateCcw className="size-3.5" />
                    Reset to default
                  </Button>
                </>
              ) : (
                <Badge variant="secondary" className="border-0">
                  Standard text
                </Badge>
              )}
            </div>
          </div>

          <Textarea
            id={`amc-text-${selected.id}`}
            rows={14}
            value={selected.value}
            onChange={(event) => onChange(selected.id, event.target.value)}
            className="min-h-72 font-mono text-[13px] leading-relaxed"
          />

          {missingTokens.length > 0 ? (
            <p className="text-destructive flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                The standard text has {missingTokens.join(", ")}, which this version is
                missing. Proposals will not fill that part in.
              </span>
            </p>
          ) : null}

          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="tabular-nums">{selected.value.length.toLocaleString()} characters</span>
          </div>

          {tokensIn(selected.fallback).length > 0 || tokensIn(selected.value).length > 0 ? (
            <div className="bg-muted/40 rounded-md p-3">
              <TokenHint />
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

/*
  FR6.5 — a key path as the field label an admin knows it by. A save that
  touched a whole group reports the group ("provider", "clauses"), so
  those read as the group's name rather than the raw key.
*/
function describeKey(path: string): string {
  const [group, key] = path.split(".");
  if (group === "clauses") {
    if (!key) return "Contract clauses";
    return CLAUSE_FIELDS.find((field) => field.key === key)?.label ?? `Clause: ${key}`;
  }
  if (group === "serviceScopes") {
    if (!key) return "Scope of work";
    const service = AMC_SERVICES.find((item) => item.id === key);
    return `Scope of work: ${service?.label ?? key}`;
  }
  if (group === "approval") return "Approvers";
  if (group === "provider") {
    if (key === "contactNo") return "Contact numbers";
    if (key === "coordinationEmails") return "Coordination emails";
    const field = PROVIDER_TEXT_FIELDS.find((item) => item.key === key);
    if (field) return field.label;
    return "Standard values";
  }
  return path;
}

const HISTORY_COLUMNS: ColumnDef<AmcSettingsHistoryItem>[] = [
  {
    id: "actor",
    header: "Changed by",
    cell: ({ row }) => (
      <IdentityCell title={row.original.actorLabel ?? "Unknown user"} subtitle={null} icon={UserRound} />
    ),
    enableSorting: false,
  },
  {
    id: "when",
    header: "When",
    cell: ({ row }) => (
      <IconText icon={Clock} muted>
        <time dateTime={row.original.createdAt}>
          {new Date(row.original.createdAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </IconText>
    ),
    enableSorting: false,
  },
  {
    id: "changed",
    header: "What changed",
    cell: ({ row }) => (
      <div className="flex max-w-xl flex-wrap gap-1">
        {row.original.changedKeys.map((key) => (
          <Badge key={key} variant="secondary" className="border-0 font-normal">
            {describeKey(key)}
          </Badge>
        ))}
      </div>
    ),
    enableSorting: false,
  },
];

/*
  FR6.5 — who changed what, and when, in the house table. The newest ten;
  the full trail is in amc_audit_events, which is append-only.
*/
function SettingsHistory({ history }: { history: AmcSettingsHistoryItem[] }) {
  return (
    <SectionCard
      icon={<History />}
      title="Change history"
      description="The last ten changes: who made them, what they changed, and when."
      bodyClassName="border-t"
    >
      <DataTable
        columns={HISTORY_COLUMNS}
        data={history}
        loading={false}
        rowCount={history.length}
        pageSize={Math.max(history.length, 1)}
        currentPage={0}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        onGlobalFilterChange={() => undefined}
        emptyState={
          <EmptyState
            className="border-0"
            icon={<ScrollText className="size-5" />}
            title="No changes yet"
            description="Every field still uses the standard wording."
          />
        }
      />
    </SectionCard>
  );
}
