"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  FileText,
  History,
  Phone,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  UserCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { AmcPhoneInput } from "./components/amc-phone-input";
import {
  ActionDialogContent,
  ErrorState,
  FieldsSkeleton,
  SectionSkeleton,
  SubmitButton,
  useConfirm,
} from "@/components/dashboard/shared/kaizen-states";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QuoteRichText } from "@/components/dashboard/snagging/quote-rich-text";
import {
  clauseTextToHtml,
  htmlToClauseText,
  roundTrips,
} from "./amc-clause-editor";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  amcSettingsService,
  type AmcSettingsHistoryItem,
} from "@/modules/amc-submissions";

import { AMC_BROCHURE_FIELDS } from "./amc-brochure-copy";
import { AMC_SERVICES } from "./amc-constants";
import {
  AMC_UNIT_TYPES,
  clausesByRole,
  getAmcSettingsDefaults,
  unitTypesLabel,
  type AmcClause,
  type AmcClauseRole,
  type AmcSettings,
  type AmcSettingsOverrides,
} from "./amc-settings";

type AmcUnitType = (typeof AMC_UNIT_TYPES)[number];

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

/*
  The clauses an admin writes, as against the document's own scaffolding.

  "Operation", "Emergency & Non-Emergency Call-Out" and "Service Frequency
  & Provisions" are section headings the contract has always had, and the
  services table and the signature block are drawn rather than written.
  They are all clauses to the builder -- they carry numbers, and the ones
  after them follow -- but there is nothing to edit in them, so listing
  them here only made the list harder to read.
*/
/*
  The document's own structure, not wording anybody edits: the headings
  the numbered clauses hang from, the services loop, the frequency table,
  the signature block. They are built rather than written, so they are not
  in the list -- the numbering still counts them, which is why it runs
  1.1, 1.2, 1.3, 2 rather than starting at 1.
*/
const SCAFFOLDING = new Set([
  "operation",
  "callOuts",
  "frequency",
  "scopeServices",
  "servicesTable",
  "signatures",
]);

const EDITABLE_CLAUSE = (clause: AmcClause) => !SCAFFOLDING.has(clause.id);

/** What each standard clause is for, keyed by the role it plays. */
/*
  Clauses whose heading the document takes from their own first paragraph,
  not from their title -- the price list and the handyman rates.
*/
const HEADING_FROM_BODY = new Set<string>(["priceListIntro", "handymanRates"]);

/**
 * Clauses that print under the clause above rather than announcing
 * themselves, so the list says so instead of showing a number that
 * belongs to something else. The document builder holds the same set
 * (amc-document-model, NO_HEADING); these two are the ones the contract
 * runs on without a heading.
 */
const RUNS_ON_ABOVE = new Set([
  "excludedOffer",
  "bankDetails",
  "invoiceTerms",
  "contractConfirmation",
  "signatures",
]);

const CLAUSE_HINTS: Partial<Record<AmcClauseRole, string>> = {};

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
];

/* One copy of the wording: the hints come from the field list above. */
for (const field of CLAUSE_FIELDS) CLAUSE_HINTS[field.key] = field.hint;

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
    { key: "proposalValidity", label: "Proposal validity", hint: "Kept for reference. Not printed on proposals yet; each proposal gets its own validity date in a later update." },
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
    The clause list is edited in place: the document is built from its
    order, so adding, moving and removing are what make the contract
    change rather than just its wording.

    `clauses` is kept in step because everything that renders a document
    still reads it by role.
  */
  const setClauseList = (next: AmcClause[]) =>
    setSettings((current) =>
      current
        ? { ...current, clauseList: next, clauses: { ...current.clauses, ...clausesByRole(next) } }
        : current,
    );

  const editClause = (id: string, change: Partial<AmcClause>) =>
    setSettings((current) => {
      if (!current) return current;
      const next = current.clauseList.map((clause) =>
        clause.id === id ? { ...clause, ...change } : clause,
      );
      return { ...current, clauseList: next, clauses: { ...current.clauses, ...clausesByRole(next) } };
    });

  /*
    Puts one clause where the drop said, which is either side of the row
    it was dropped on -- `beforeId` is the row it now comes before, and
    null means the end of the list.
  */
  const reorderClause = (id: string, beforeId: string | null) => {
    if (!settings) return;
    const next = settings.clauseList.filter((clause) => clause.id !== id);
    const moved = settings.clauseList.find((clause) => clause.id === id);
    if (!moved) return;
    const at = beforeId ? next.findIndex((clause) => clause.id === beforeId) : -1;
    if (at < 0) next.push(moved);
    else next.splice(at, 0, moved);
    setClauseList(next);
  };

  const removeClause = (id: string) => {
    if (!settings) return;
    setClauseList(settings.clauseList.filter((clause) => clause.id !== id));
  };

  /*
    A new clause is saved as it is added.

    Adding something and then having to remember a separate Save is how a
    clause goes missing: the list is a list of things that exist, not a
    draft of one. Wording edits still batch behind Save changes, because
    those are typed a character at a time.
  */
  const addClause = async (draft: { title: string; body: string }) => {
    if (!settings) return null;
    /* Its own id, so it survives being renamed and moved. */
    const id = `custom-${Date.now().toString(36)}`;
    const clauseList: AmcClause[] = [
      ...settings.clauseList,
      { id, title: draft.title, body: draft.body, level: 1, enabled: true },
    ];
    const next: AmcSettings = {
      ...settings,
      clauseList,
      clauses: { ...settings.clauses, ...clausesByRole(clauseList) },
    };
    setSettings(next);
    return (await handleSave(next)) ? id : null;
  };

  /*
    Services, edited the same way the clauses are: the order they are
    offered in, what they are called, and which ones exist at all.
  */
  const reorderService = (id: string, beforeId: string | null) => {
    if (!settings) return;
    const rest = settings.services.filter((service) => service.id !== id);
    const moved = settings.services.find((service) => service.id === id);
    if (!moved) return;
    const at = beforeId ? rest.findIndex((service) => service.id === beforeId) : -1;
    if (at < 0) rest.push(moved);
    else rest.splice(at, 0, moved);
    patch({ services: rest });
  };

  const removeService = (id: string) => {
    if (!settings) return;
    patch({ services: settings.services.filter((service) => service.id !== id) });
  };

  /* Saved as it is added, for the same reason a clause is. */
  const addService = async (draft: {
    title: string;
    body: string;
    unitTypes?: AmcUnitType[];
  }) => {
    if (!settings) return null;
    const id = `custom-${Date.now().toString(36)}`;
    const next: AmcSettings = {
      ...settings,
      services: [
        ...settings.services,
        {
          id,
          label: draft.title,
          scope: draft.title,
          sectionTitle: `${draft.title}:`,
          /* A number of visits a year is the ordinary case; the proposal
             sets how many. */
          frequencyType: "ppm" as const,
          frequencyPerYear: 4,
          villaOnly: false,
          /* Every kind unless the dialog narrowed it. */
          unitTypes: draft.unitTypes?.length ? draft.unitTypes : [...AMC_UNIT_TYPES],
          hasScopeSection: true,
          reference: "",
          enabled: true,
        },
      ],
      serviceScopes: { ...settings.serviceScopes, [id]: draft.body },
    };
    setSettings(next);
    return (await handleSave(next)) ? id : null;
  };

  /* What a clause looked like as shipped, for "Reset to default". */
  const defaultBodyOf = (clause: AmcClause) =>
    defaults.clauseList.find((item) => item.id === clause.id)?.body ?? clause.body;

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

      /* The brochure field by field, like the clauses: only what was edited. */
      const brochure = Object.fromEntries(
        AMC_BROCHURE_FIELDS.map(({ key }) => [key, current.brochure[key]]).filter(
          ([key, value]) => isCustomised(value as string, defaults.brochure[key as keyof AmcSettings["brochure"]]),
        ),
      );

      const sameList = (a: string[], b: string[]) =>
        [...a].sort().join("|") === [...b].sort().join("|");
      const approvalChanged = !sameList(current.approval.approvers, defaults.approval.approvers);

      /*
        The clause list goes whole or not at all: a clause added, removed
        or moved cannot be expressed as a per-key edit. Untouched, it stays
        out of the override document, so a later release that corrects a
        clause still reaches this install.
      */
      const listChanged =
        JSON.stringify(current.clauseList) !== JSON.stringify(defaults.clauseList);
      /* Same for the services: added, removed or reordered is not a
         per-key edit either. */
      const servicesChanged =
        JSON.stringify(current.services) !== JSON.stringify(defaults.services);
      /*
        And the account managers, whole, for the same reason: a list has
        no per-key edit to express. Ships empty, so anything at all here
        is a change.
      */
      const managersChanged =
        JSON.stringify(current.accountManagers) !==
        JSON.stringify(defaults.accountManagers);

      return {
        ...(approvalChanged ? { approval: current.approval } : {}),
        ...(providerChanged ? { provider: current.provider } : {}),
        ...(Object.keys(clauses).length ? { clauses } : {}),
        ...(listChanged ? { clauseList: current.clauseList } : {}),
        ...(servicesChanged ? { services: current.services } : {}),
        ...(Object.keys(serviceScopes).length ? { serviceScopes } : {}),
        ...(Object.keys(brochure).length ? { brochure } : {}),
        ...(managersChanged ? { accountManagers: current.accountManagers } : {}),
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

  const handleSave = async (next?: AmcSettings) => {
    const current = next ?? settings;
    if (!current) return false;
    setSaving(true);
    try {
      const response = await amcSettingsService.saveSettings(
        buildOverrides(current),
      );
      setSettings(response.settings);
      setSaved(response.settings);
      if (response.history) setHistory(response.history);
      toast.success(
        response.changedKeys?.length
          ? `Saved. ${response.changedKeys.length} field${response.changedKeys.length === 1 ? "" : "s"} updated. New proposals will use this text.`
          : "Saved. There was nothing to change.",
      );
      return true;
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Couldn't save AMC Settings",
      );
      return false;
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
            <SubmitButton
              onClick={() => void handleSave()}
              disabled={!dirty}
              pending={saving}
              pendingLabel="Saving…"
              icon={<Save className="size-4" />}
            >
              Save changes
            </SubmitButton>
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
        <SectionSkeleton>
          <FieldsSkeleton fields={6} columns={3} />
        </SectionSkeleton>
      </div>
    );
  }

  if (loadFailed || !settings) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <ErrorState
          title="Couldn't load AMC settings"
          message="Something went wrong on our side. This is usually temporary, so try again in a moment."
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    );
  }

  const customisedClauses = settings.clauseList.filter(EDITABLE_CLAUSE).filter((clause) => {
    const shipped = defaults.clauseList.find((item) => item.id === clause.id);
    /* A clause somebody added is theirs entirely, so it counts. */
    return !shipped || isCustomised(clause.body, shipped.body) || clause.title !== shipped.title;
  }).length;
  const customisedScopes = settings.services.filter((service) =>
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
          {
            value: "clauses",
            label: "Contract clauses",
            count: settings.clauseList.filter(EDITABLE_CLAUSE).length,
          },
          { value: "scopes", label: "Scope of work", count: settings.services.length },
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

          {/*
            The account managers a proposal can name (Jonathan, Oct 2026).

            Clause 1.1 names one or two of them with a direct number, and
            both were typed out per proposal -- so the same colleague
            reached different clients under three spellings and, twice,
            under a number that was no longer theirs. Kept here, picked
            there, and the number travels with the name.

            Inside Standard values rather than on a tab of its own:
            everything on this card is a value that prints on every
            document, and this is one more of them.
          */}
          <div className="mt-6 border-t pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Account managers</h3>
                <p className="text-muted-foreground text-xs pt-1">
                  Offered on every proposal. The direct number is filled in
                  from here, so it is corrected in one place.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    accountManagers: [
                      ...settings.accountManagers,
                      { name: "", phone: "" },
                    ],
                  })
                }
              >
                <Plus className="size-4" />
                Add manager
              </Button>
            </div>

            {settings.accountManagers.length === 0 ? (
              <p className="text-muted-foreground mt-4 text-xs">
                None yet. Until one is added, a proposal asks for the name and
                the number to be typed, as it does today.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {settings.accountManagers.map((manager, index) => (
                  <div
                    key={index}
                    className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`amc-manager-name-${index}`}>Name</Label>
                      <Input
                        id={`amc-manager-name-${index}`}
                        value={manager.name}
                        placeholder="Full name"
                        onChange={(event) => {
                          const next = [...settings.accountManagers];
                          next[index] = { ...next[index], name: event.target.value };
                          patch({ accountManagers: next });
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`amc-manager-phone-${index}`}>
                        Direct number
                      </Label>
                      {/*
                        The same control every other phone field in the
                        product uses, storing the full international
                        number. A plain text box let "03420285429" be
                        saved as typed, and that number then travels on to
                        every proposal that names this person -- which is
                        the whole reason the list exists.
                      */}
                      <AmcPhoneInput
                        id={`amc-manager-phone-${index}`}
                        value={manager.phone}
                        onChange={(phone) => {
                          const next = [...settings.accountManagers];
                          next[index] = { ...next[index], phone };
                          patch({ accountManagers: next });
                        }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${manager.name || "this account manager"}`}
                      onClick={() =>
                        patch({
                          accountManagers: settings.accountManagers.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-muted-foreground text-xs">
                  Removing somebody here leaves the proposals that already
                  name them untouched; it only stops them being offered.
                </p>
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      {view === "clauses" ? (
        <TextLibrary
          icon={<FileText />}
          searchable
          title="Contract clauses"
          description={`They print in this order and are numbered from it. A clause you haven't edited keeps the standard wording. ${customisedClauses} of ${settings.clauseList.filter(EDITABLE_CLAUSE).length} customised.`}
          addLabel="Add clause"
          items={settings.clauseList.filter(EDITABLE_CLAUSE).map((clause) => ({
            id: clause.id,
            label: clause.title,
            /*
              No number here, on purpose.

              The list used to show what each clause prints under. That
              number depends on the proposal: a clause that draws nothing
              takes no number, and the price list is switched on per
              proposal, so one clause can be 6.2 on one contract and 6.3
              on the next. The list could only ever show one of them, and
              it showed several clauses the number of the clause above.
              Order is the thing that is actually true here, so order is
              what it shows.
            */
            hint: RUNS_ON_ABOVE.has(clause.role ?? "")
              ? "Prints under the clause above it rather than under a heading of its own."
              : clause.role
                ? CLAUSE_HINTS[clause.role]
                : "Your own clause. It prints where it sits in this list.",
            /*
              Two clauses print their first paragraph as their own heading
              rather than this title, so say so instead of letting a rename
              here quietly do nothing to the contract.
            */
            renameNote: HEADING_FROM_BODY.has(clause.role ?? "")
              ? "This clause prints its first paragraph as its heading. Edit that in the text to change what the contract shows."
              : undefined,
            value: clause.body,
            fallback: defaultBodyOf(clause),
            /* A clause the contract builds rather than merely prints. */
            fixed: Boolean(clause.role),
          }))}
          onChange={(id, text) => editClause(id, { body: text })}
          onRename={(id, title) => editClause(id, { title })}
          onReorder={reorderClause}
          onDelete={removeClause}
          onAdd={addClause}
        />
      ) : null}

      {view === "scopes" ? (
        /* FR6.2 — "the scope of work for each service". The services are
           settings now, so this list is the services themselves. */
        <TextLibrary
          icon={<Wrench />}
          title="Service scope of work"
          description={`What each service covers, as it prints in the contract. They are offered in this order. ${customisedScopes} of ${settings.services.length} customised.`}
          searchable
          addLabel="Add service"
          items={settings.services.map((service) => ({
            id: service.id,
            label: service.label,
            hint: unitTypesLabel(service),
            value: settings.serviceScopes[service.id] ?? "",
            fallback: defaults.serviceScopes[service.id] ?? "",
          }))}
          onChange={(id, text) =>
            patch({ serviceScopes: { ...settings.serviceScopes, [id]: text } })
          }
          onRename={(id, label) =>
            patch({
              services: settings.services.map((service) =>
                service.id === id ? { ...service, label, scope: label } : service,
              ),
            })
          }
          onReorder={reorderService}
          onDelete={removeService}
          onAdd={addService}
          unitTypes
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
  /**
   * The document builds this one rather than merely printing it -- the
   * scope loop, the price list, the bank table. It can still be reworded,
   * renamed, moved and removed; removing it is what needs saying plainly.
   */
  fixed?: boolean;
  /** Said in the rename dialog, where the name alone is not the whole story. */
  renameNote?: string;
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
  addLabel,
  onAdd,
  unitTypes: asksUnitTypes,
  onDelete,
  onReorder,
  onRename,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  items: LibraryItem[];
  onChange: (id: string, text: string) => void;
  searchable?: boolean;
  /** Given together, these turn the library into a list you can edit. */
  addLabel?: string;
  /** Saves as it adds; the id it was given, or null if the save failed. */
  onAdd?: (draft: {
    title: string;
    body: string;
    unitTypes?: AmcUnitType[];
  }) => Promise<string | null>;
  /** Asks which kinds of property the new one is offered on. */
  unitTypes?: boolean;
  onDelete?: (id: string) => void;
  /** Puts `id` where `beforeId` is; at the end when that is null. */
  onReorder?: (id: string, beforeId: string | null) => void;
  onRename?: (id: string, title: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  /*
    Where it would land: the row the line is drawn against, and which of
    its edges. Dropping "on" a row is ambiguous -- dragging something down
    onto row 7 plainly means putting it at 7, not above 7 -- so the drop
    point is the gap the pointer is nearest, and the line shows it.
  */
  const [overId, setOverId] = useState<string | null>(null);
  const [overBelow, setOverBelow] = useState(false);
  const [adding, setAdding] = useState(false);
  /* The row being renamed, and what it is being renamed to. */
  const [renaming, setRenaming] = useState<LibraryItem | null>(null);
  const [rename, setRename] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  /* The add dialog saves, so it has to be able to say it is working. */
  const [addingBusy, setAddingBusy] = useState(false);
  const [draft, setDraft] = useState<{
    title: string;
    body: string;
    unitTypes: AmcUnitType[];
    /** HTML while it is being written; blocks on save. */
  }>({ title: "", body: "", unitTypes: [...AMC_UNIT_TYPES] });
  const listRef = useRef<HTMLUListElement>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? items.filter((item) => item.label.toLowerCase().includes(term)) : items;
  }, [items, query]);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const selectedIndex = items.findIndex((item) => item.id === selected?.id);

  /*
    A new entry opens on its own, and the list scrolls to it -- adding
    something and then hunting for it in a list of twenty is the whole
    reason this felt like filing rather than writing.
  */
  const reveal = (id: string) => {
    setSelectedId(id);
    setQuery("");
    window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-row="${id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  /*
    Adding saves, so the dialog stays put until it has: a list of clauses
    that only exists in the browser until somebody presses Save elsewhere
    is a list that loses one.
  */
  const submitDraft = async () => {
    if (!onAdd || !draft.title.trim() || addingBusy) return;
    if (asksUnitTypes && draft.unitTypes.length === 0) return;
    setAddingBusy(true);
    try {
      const id = await onAdd({
        title: draft.title.trim(),
        body: htmlToClauseText(draft.body),
        unitTypes: draft.unitTypes,
      });
      /* It did not save. The draft stays exactly as typed, to try again. */
      if (!id) return;
      setAdding(false);
      setDraft({ title: "", body: "", unitTypes: [...AMC_UNIT_TYPES] });
      reveal(id);
    } finally {
      setAddingBusy(false);
    }
  };

  const openRename = (item: LibraryItem) => {
    setRenaming(item);
    setRename(item.label);
    setRenameError(null);
  };

  const submitRename = () => {
    if (!renaming || !rename.trim()) return;
    if (rename.trim() !== renaming.label) onRename?.(renaming.id, rename.trim());
    setRenaming(null);
  };

  const removeItem = async (item: LibraryItem) => {
    if (!onDelete) return;
    const ok = await confirm({
      title: `Remove "${item.label}"?`,
      description: item.fixed
        ? "It stops printing on new documents, and the ones after it are renumbered. Documents already sent keep it."
        : "It stops printing on new documents. Documents already sent keep it.",
      confirmText: "Remove",
      variant: "destructive",
    });
    if (ok) onDelete(item.id);
  };

  if (!selected) return null;

  const customised = isCustomised(selected.value, selected.fallback);
  const missingTokens = tokensIn(selected.fallback).filter(
    (token) => !selected.value.includes(token),
  );
  const draggable = Boolean(onReorder) && !query.trim();

  return (
    /* overflow-visible: the card normally clips its content for its rounded
       corners, and a clipping parent stops the list below from sticking. */
    <SectionCard
      icon={icon}
      title={title}
      description={description}
      bodyClassName="border-t"
      className="overflow-visible"
      action={
        onAdd ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {addLabel ?? "Add"}
          </Button>
        ) : undefined
      }
    >
      {confirmDialog}

      {/* Named and written in one place, rather than an untitled row
          appearing at the bottom of the list to be found and filled in. */}
      <Dialog open={adding} onOpenChange={(open) => !open && !addingBusy && setAdding(false)}>
        <ActionDialogContent busy={addingBusy} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{addLabel ?? "Add"}</DialogTitle>
            <DialogDescription>
              It is saved straight away and added at the end. Drag it up the
              list, or set its number, to place it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="amc-new-title">Title</Label>
              <Input
                id="amc-new-title"
                autoFocus
                value={draft.title}
                placeholder="e.g. Data Protection"
                onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitDraft();
                }}
              />
            </div>
            {asksUnitTypes ? (
              /*
                Which properties it is offered on. Everything by default,
                because most services are -- narrowing it is the choice,
                not the starting point.
              */
              <div className="space-y-1.5">
                <Label>Offered on</Label>
                <div className="flex flex-wrap gap-2">
                  {AMC_UNIT_TYPES.map((type) => {
                    const on = draft.unitTypes.includes(type);
                    return (
                      <Button
                        key={type}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            unitTypes: on
                              ? d.unitTypes.filter((item) => item !== type)
                              : [...d.unitTypes, type],
                          }))
                        }
                      >
                        {type === "villa" ? "Villas" : type === "apartment" ? "Apartments" : "Offices"}
                      </Button>
                    );
                  })}
                </div>
                {draft.unitTypes.length === 0 ? (
                  <p className="text-destructive text-xs">
                    Pick at least one, or it can never be offered.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Text</Label>
              <QuoteRichText
                ariaLabel="Text"
                value={draft.body}
                onChange={(html) => setDraft((d) => ({ ...d, body: html }))}
                tools={["subheading", "bullet"]}
                placeholder="Each paragraph prints as its own block, in the order shown."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={addingBusy} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <SubmitButton
              disabled={!draft.title.trim() || (asksUnitTypes && draft.unitTypes.length === 0)}
              pending={addingBusy}
              pendingLabel="Saving…"
              icon={<Plus className="size-4" />}
              onClick={() => void submitDraft()}
            >
              {addLabel ?? "Add"}
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>

      {/* Renaming is its own small thing, asked for and confirmed --
          not a title box that rewrites the document as it is typed. */}
      <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && setRenaming(null)}>
        <ActionDialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit</DialogTitle>
            <DialogDescription>
              The heading it prints under, and where it prints. Documents
              already sent keep what they were sent with.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="amc-rename">Title</Label>
              <Input
                id="amc-rename"
                autoFocus
                value={rename}
                onChange={(event) => setRename(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitRename();
                }}
              />
              {renaming?.renameNote ? (
                <p className="text-muted-foreground text-xs">{renaming.renameNote}</p>
              ) : null}
            </div>
            {renameError ? (
              <p className="text-destructive flex items-start gap-1.5 text-xs">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{renameError}</span>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <SubmitButton disabled={!rename.trim()} onClick={submitRename} icon={<Save className="size-4" />}>
              Save
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>

      <div className="grid lg:grid-cols-[21rem_minmax(0,1fr)]">
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
            <ul ref={listRef} className="max-h-[28rem] overflow-y-auto p-2 lg:max-h-[36rem]">
              {shown.length === 0 ? (
                <li className="text-muted-foreground px-3 py-6 text-center text-sm">
                  Nothing matches that.
                </li>
              ) : (
                shown.map((item) => {
                  const active = item.id === selected.id;
                  const changed = isCustomised(item.value, item.fallback);
                  return (
                    <li
                      key={item.id}
                      data-row={item.id}
                      draggable={draggable}
                      onDragStart={() => setDragId(item.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      onDragOver={(event) => {
                        if (!dragId || dragId === item.id) return;
                        event.preventDefault();
                        const box = event.currentTarget.getBoundingClientRect();
                        setOverId(item.id);
                        setOverBelow(event.clientY > box.top + box.height / 2);
                      }}
                      onDragLeave={(event) => {
                        /* Only when the pointer has actually left the row,
                           not when it crosses onto the label inside it. */
                        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                        setOverId((current) => (current === item.id ? null : current));
                      }}
                      onDrop={(event) => {
                        if (!dragId || dragId === item.id) return;
                        event.preventDefault();
                        const box = event.currentTarget.getBoundingClientRect();
                        const below = event.clientY > box.top + box.height / 2;
                        /* Below this row means before whatever follows it,
                           and the end of the list when nothing does. */
                        const index = shown.findIndex((row) => row.id === item.id);
                        const target = below ? (shown[index + 1]?.id ?? null) : item.id;
                        /* Dropping either side of itself is not a move. */
                        if (target !== dragId) onReorder?.(dragId, target);
                        setDragId(null);
                        setOverId(null);
                      }}
                      /* The row is the whole target: a handle you have to
                         hit exactly is worse than grabbing the thing
                         itself, and the handle still says it can be
                         dragged. */
                      className={cn(
                        "group/row relative flex items-center rounded-md ps-2 transition-colors",
                        /* Opaque on hover, because the actions below sit on this
                           colour and have to cover what is behind them. */
                        active ? "bg-brand-50 text-brand" : "bg-card hover:bg-muted",
                        draggable && "cursor-grab active:cursor-grabbing",
                        dragId === item.id && "opacity-40",
                        /* A line in the gap it would go into. */
                        overId === item.id &&
                        dragId !== item.id &&
                        "before:bg-brand before:absolute before:inset-x-2 before:h-0.5 before:rounded-full before:content-['']",
                        overId === item.id &&
                        dragId !== item.id &&
                        (overBelow ? "before:-bottom-px" : "before:-top-px"),
                      )}
                    >
                      {draggable ? (
                        <GripVertical
                          className="text-muted-foreground/70 pointer-events-none absolute start-0.5 top-1/2 size-4 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100"
                          aria-hidden
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        title={item.label}
                        className={cn(
                          "focus-visible:ring-ring min-w-0 flex-1 rounded-md py-2.5 pe-2 ps-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                          active && "font-medium",
                        )}
                      >
                        {/* Two lines before it gives up, rather than cutting
                            "Materials, Spare Parts, Consumables & Labor" off
                            at the comma with half the row still empty. */}
                        <span className="line-clamp-2 break-words">{item.label}</span>
                      </button>
                      {changed ? (
                        <span
                          className="bg-warning me-2 size-2 shrink-0 rounded-full transition-opacity group-hover/row:opacity-0"
                          title="Customised"
                          aria-label="Customised"
                        />
                      ) : null}
                      {/* The row's own actions. Laid over the end of the row
                          rather than beside it, on the row's own background,
                          so a title is not cut short to hold space for
                          buttons that are not being shown. */}
                      {onDelete || onRename ? (
                        <span className="absolute end-1 top-1/2 flex shrink-0 -translate-y-1/2 items-center rounded-md bg-inherit ps-3 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                          {onRename ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-foreground size-7"
                              aria-label={`Edit ${item.label}`}
                              title="Edit"
                              onClick={() => openRename(item)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          ) : null}
                          {onDelete ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive size-7"
                              aria-label={`Remove ${item.label}`}
                              title="Remove"
                              onClick={() => void removeItem(item)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
            {draggable ? (
              <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                Drag to reorder. They print in this order.
              </p>
            ) : null}
          </div>
        </div>

        {/* The editor */}
        <div className="min-w-0 space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor={`amc-text-${selected.id}`} className="text-base font-semibold">
                {selected.label}
              </Label>
              {selected.hint ? (
                <p className="text-muted-foreground mt-0.5 text-sm">{selected.hint}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {/* Keyboard's way to reorder: dragging is a mouse, and the
                  order is part of the document. */}
              {onReorder ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Move up"
                    title="Move up"
                    disabled={selectedIndex <= 0}
                    onClick={() => onReorder(selected.id, items[selectedIndex - 1]?.id ?? null)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Move down"
                    title="Move down"
                    disabled={selectedIndex < 0 || selectedIndex >= items.length - 1}
                    onClick={() => onReorder(selected.id, items[selectedIndex + 2]?.id ?? null)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </>
              ) : null}
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

          {/*
            The same editor the snagging quotation's scope and terms use,
            so a paragraph looks like a paragraph instead of a blank line
            counted in a monospace box.

            Wording the editor cannot hold exactly -- a line break inside a
            paragraph -- keeps the plain box: losing a line of a contract to
            a convenience is not a trade worth making.
          */}
          {roundTrips(selected.value) ? (
            <QuoteRichText
              key={selected.id}
              ariaLabel={selected.label}
              value={clauseTextToHtml(selected.value)}
              onChange={(html) => onChange(selected.id, htmlToClauseText(html))}
              tools={["subheading", "bullet"]}
              placeholder="Each paragraph prints as its own block, in the order shown."
            />
          ) : (
            <Textarea
              id={`amc-text-${selected.id}`}
              rows={14}
              value={selected.value}
              onChange={(event) => onChange(selected.id, event.target.value)}
              className="min-h-72 font-mono text-[13px] leading-relaxed"
            />
          )}

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
  if (group === "brochure") {
    if (!key) return "Proposal brochure";
    const field = AMC_BROCHURE_FIELDS.find((item) => item.key === key);
    return `Proposal brochure: ${field?.label ?? key}`;
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
