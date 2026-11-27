"use client";

import { useState } from "react";
import { ArrowUpRight, Save, Search, UserCheck, X } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { AmcConfig, AmcConfigSection } from "@/lib/amc/config";
import type { AmcConfigUser } from "@/modules/amc-platform/amc-platform-service";

import type { ConfigView, PersonNeed } from "./config-fields";

/**
 * Everyone the business names before go-live, in one place (DEV-488, BRD
 * v0.4 5.5 "approvers must be named before go live", 5.17 first release):
 * the approvers per level, the escalation contacts, Finance, the
 * supervisors and the internal signatories. Each row says who is named, or
 * that nobody is yet and what happens meanwhile. Name them / Change picks
 * the people here, in a dialog (23 Nov 2026), and saves that list in its
 * section; "All … settings" opens the section itself.
 */

type Row = {
  key: string;
  label: string;
  ids: readonly string[];
  /** What happens while nobody is named. */
  fallback: string;
  /** Needed for the first release (BRD 5.17). */
  required: boolean;
  /** The tab and section with the related settings (none for the AMC approvers). */
  view?: ConfigView;
  /** Where the list is kept: the section and its field. */
  section?: AmcConfigSection;
  field?: string;
  /**
   * What they do and when (24 Nov 2026): shown under each row and in its
   * dialog, so nobody has to guess what being named here means.
   */
  help: string;
  /** A list kept elsewhere (the AMC approvers, in AMC settings): its own right and save. */
  custom?: { canEdit: boolean; save: (ids: string[]) => Promise<void> };
  /** What a person's role must allow to be named here (23 Nov 2026). */
  need: PersonNeed;
};

/** The AMC approvers are kept by email; someone listed who is not a portal user here keeps an "email:" id. */
const EMAIL_ID = "email:";

const VIEW_NAMES: Partial<Record<ConfigView, string>> = {
  approvals: "Approvals and payments",
  scheduling: "Scheduling and SLA",
  pipeline: "Pipeline and contracts",
};

/** How many of the people needed for go-live are not named yet (the tab's count). */
export function namedPeopleMissing(config: AmcConfig): number {
  return namedPeopleRows(config).filter((r) => r.required && r.ids.length === 0).length;
}

/** What sends a proposal to an approval level, from the Approvals settings. */
function levelTriggers(config: AmcConfig, level: 1 | 2 | 3): string {
  const a = config.approvals;
  const discount = level === 1 ? a.discountLevel1AbovePercent : level === 2 ? a.discountLevel2AbovePercent : a.discountLevel3AbovePercent;
  const value = level === 1 ? a.valueLevel1AboveAed : level === 2 ? a.valueLevel2AboveAed : a.valueLevel3AboveAed;
  const parts = [
    discount != null ? `a discount above ${discount}%` : null,
    value != null ? `a value above AED ${Number(value).toLocaleString("en-US")}` : null,
    a.nonStandardPlanLevel === level ? "a non-standard payment plan" : null,
    a.belowFloorLevel === level ? "a price below the floor rate" : null,
  ].filter((p): p is string => Boolean(p));
  if (!parts.length) return "(no rule sends proposals here yet; set one in Approvals and payments)";
  return `with ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`}`;
}

function namedPeopleRows(config: AmcConfig): Row[] {
  const hours = config.approvals.escalateAfterHours;
  return [
    {
      key: "l1",
      label: `${config.approvals.level1Name || "Level 1"} approvers`,
      ids: config.approvals.level1ApproverIds,
      fallback: "Proposals at this level are decided by the AMC approvers (all levels), or, if none are named, by anyone with the AMC approve permission.",
      required: true,
      view: "approvals",
      section: "approvals",
      field: "level1ApproverIds",
      need: "approve",
      help: `Proposals: when a proposal is submitted ${levelTriggers(config, 1)}, it comes to them first; they approve it, send it back for changes, or reject it. Not decided within ${hours} hours, it is escalated. Also, as the first named level: they approve or reject contract amendments (hold, early termination, cancellation, scope change), approve or send back completed site visits, and review job sheets while no supervisor is named.`,
    },
    {
      key: "l2",
      label: `${config.approvals.level2Name || "Level 2"} approvers`,
      ids: config.approvals.level2ApproverIds,
      fallback: "Proposals at this level are decided by the AMC approvers (all levels), or, if none are named, by anyone with the AMC approve permission.",
      required: true,
      view: "approvals",
      section: "approvals",
      field: "level2ApproverIds",
      need: "approve",
      help: `Proposals ${levelTriggers(config, 2)} come to them after level 1 approves; they approve it, send it back or reject it. Amendments and site visits come to them only while level 1 names nobody.`,
    },
    {
      key: "l3",
      label: `${config.approvals.level3Name || "Level 3"} approvers`,
      ids: config.approvals.level3ApproverIds,
      fallback: "No third level: leave it empty if there is none.",
      required: false,
      view: "approvals",
      section: "approvals",
      field: "level3ApproverIds",
      need: "approve",
      help: `Only if there is a third level: proposals ${levelTriggers(config, 3)} come to them after level 2 approves. Amendments and site visits come to them only while levels 1 and 2 name nobody. Leave it empty if there is no third level.`,
    },
    {
      key: "escalation",
      label: "Escalation contacts",
      ids: config.approvals.escalationUserIds ?? [],
      fallback: "Escalations go to the level 2 approvers, else level 1.",
      required: true,
      view: "approvals",
      section: "approvals",
      field: "escalationUserIds",
      need: "amc",
      help: `They decide nothing day to day. They are told, with a to-do, when something is stuck: a proposal approval past ${hours} hours whose next level names nobody, a to-do not done in time, an enquiry left with no contact, a renewal nobody acts on, an instalment overdue.`,
    },
    {
      key: "finance",
      label: "Finance",
      ids: config.payments.financeUserIds ?? [],
      fallback: "Nobody in Finance hears about payments or gets the overdue instalment to-do.",
      required: true,
      view: "approvals",
      section: "payments",
      field: "financeUserIds",
      need: "payments",
      help: "They approve nothing. With the contract owner they are told about payments (received, coming due, cheque dates), and when an instalment is overdue they get the \"Instalment overdue\" to-do.",
    },
    {
      key: "supervisors",
      label: "Supervisors",
      ids: config.scheduling.supervisorUserIds ?? [],
      fallback: "Job sheets are reviewed and closed by the level 1 approvers.",
      required: true,
      view: "scheduling",
      section: "scheduling",
      field: "supervisorUserIds",
      need: "visits",
      help: "When a technician submits a job sheet from the app, it comes to them in Job reviews: they return it to the technician with a reason, or close the visit (the client gets the service report). They are also told when a visit's SLA is at risk.",
    },
    {
      key: "signatories",
      label: "Internal signatories",
      ids: config.contracts.internalSignatoryIds ?? [],
      fallback: "Only the client signs the contract.",
      required: false,
      view: "pipeline",
      section: "contracts",
      field: "internalSignatoryIds",
      need: "contracts",
      /* As "Who signs first" (Pipeline and contracts) sets it (27 Nov 2026). */
      help:
        config.contracts.signingOrder === "internal_first"
          ? "They sign first, in the order picked, each in turn; then the contract goes to the client, and it is signed once the client has. Leave it empty if only the client signs."
          : "After the client signs, the contract goes to them in the order picked, each signing in turn; it is signed once the last one has. Leave it empty if only the client signs.",
    },
  ];
}

export function NamedPeopleCard({
  config,
  users,
  onOpen,
  onSave,
  canEdit,
  generalApprovers,
}: {
  config: AmcConfig;
  users: AmcConfigUser[];
  /** The AMC approvers (all levels), from AMC settings; null while loading or when it cannot be read. */
  generalApprovers?: { emails: string[]; canEdit: boolean; save: (emails: string[]) => Promise<void> } | null;
  /** Opens the tab and section where the list is kept. */
  onOpen: (view: ConfigView, section: AmcConfigSection) => void;
  /** Saves one section (as its own form does). */
  onSave: <K extends AmcConfigSection>(section: K, value: AmcConfig[K]) => Promise<void>;
  canEdit: Partial<Record<AmcConfigSection, boolean>>;
}) {
  const nameOf = new Map<string, string>(users.map((u) => [u.id, u.name || u.email || "Unknown user"]));
  /* The AMC approvers (moved here from AMC settings, 23 Nov 2026): by email, shown as the people they are. */
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u.id]));
  const approverRow: Row | null = generalApprovers
    ? {
        key: "amc-approvers",
        label: "AMC approvers (all levels)",
        ids: generalApprovers.emails.map((e) => byEmail.get(e.toLowerCase()) ?? `${EMAIL_ID}${e}`),
        fallback: "Levels that name nobody are decided by anyone whose role has the AMC approve permission.",
        required: false,
        need: "approve",
        help: "Proposals: they decide any approval level that names nobody. Amendments and site visits: they decide them while no level names anyone. Any time: they may take the approver-only actions (make a chargeable call-out line free, book on an expired contract). An approver may approve their own request.",
        custom: {
          canEdit: generalApprovers.canEdit,
          save: (ids) => generalApprovers.save(ids.map((id) => (id.startsWith(EMAIL_ID) ? id.slice(EMAIL_ID.length) : (users.find((u) => u.id === id)?.email ?? ""))).filter(Boolean)),
        },
      }
    : null;
  for (const id of approverRow?.ids ?? []) if (id.startsWith(EMAIL_ID)) nameOf.set(id, `${id.slice(EMAIL_ID.length)} (cannot open AMC)`);
  const rows = [...(approverRow ? [approverRow] : []), ...namedPeopleRows(config)];
  const missing = rows.filter((r) => r.required && r.ids.length === 0).length;
  const [editing, setEditing] = useState<Row | null>(null);

  return (
    <>
      <SectionCard
        icon={<UserCheck />}
        title="Named people"
        description={
          missing
            ? `${missing} of the people needed for go-live ${missing === 1 ? "is" : "are"} not named yet. Name them here; each list is saved in its own settings section.`
            : "Everyone needed for go-live is named. Change anyone here; each list is saved in its own settings section."
        }
        bodyClassName="border-t"
      >
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {r.label}
                  {r.ids.length === 0 ? (
                    <Badge variant="secondary" className={r.required ? "bg-warning/10 text-warning border-0 font-medium" : "bg-mist text-ink-soft border-0 font-medium"}>
                      {r.required ? "Not named yet" : "Optional"}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {r.ids.length ? r.ids.map((id) => nameOf.get(id) ?? "A user no longer listed").join(", ") : r.fallback}
                </p>
                <p className="text-muted-foreground/80 mt-1 max-w-4xl text-xs leading-relaxed">
                  <span className="text-foreground/80 font-medium">What they do: </span>
                  {r.help}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                {r.ids.length ? "Change" : "Name them"}
              </Button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <NamePeopleDialog
        key={editing?.key ?? "none"}
        row={editing}
        users={users}
        config={config}
        canEdit={editing ? (editing.custom ? editing.custom.canEdit : Boolean(editing.section && canEdit[editing.section])) : false}
        nameOf={nameOf}
        onClose={() => setEditing(null)}
        onSave={onSave}
        onOpen={(r) => {
          if (!r.view || !r.section) return;
          setEditing(null);
          onOpen(r.view, r.section);
        }}
      />
    </>
  );
}

/** Pick the people for one list and save it in its section, without leaving the tab. */
function NamePeopleDialog({
  row,
  users,
  config,
  canEdit,
  nameOf,
  onClose,
  onSave,
  onOpen,
}: {
  row: Row | null;
  users: AmcConfigUser[];
  config: AmcConfig;
  canEdit: boolean;
  nameOf: Map<string, string>;
  onClose: () => void;
  onSave: <K extends AmcConfigSection>(section: K, value: AmcConfig[K]) => Promise<void>;
  onOpen: (row: Row) => void;
}) {
  /* Mounted afresh for each row (keyed by it), so it starts from the saved list. */
  const [picked, setPicked] = useState<string[]>(() => [...(row?.ids ?? [])]);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const label = (id: string) => nameOf.get(id) ?? "A user no longer listed";
  const toggle = (id: string) => setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));
  const term = query.trim().toLowerCase();
  /* Only people whose role allows this list (23 Nov 2026); anyone already named stays. */
  const allowed = row ? users.filter((u) => u.can?.[row.need] !== false || picked.includes(u.id)) : users;
  const shown = term ? allowed.filter((u) => [u.name, u.email ?? "", u.role ?? ""].some((v) => v.toLowerCase().includes(term))) : allowed;
  const unchanged = row ? picked.length === row.ids.length && picked.every((id, i) => id === row.ids[i]) : true;

  const save = async () => {
    if (!row) return;
    setBusy(true);
    try {
      if (row.custom) await row.custom.save(picked);
      else if (row.section && row.field) await onSave(row.section, { ...(config[row.section] as Record<string, unknown>), [row.field]: picked } as never);
      onClose();
    } catch {
      /* The page already said why. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      {/* Nothing focused on open (23 Nov 2026): the list does not jump open, the keyboard does not pop up on a phone. */}
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(ev) => ev.preventDefault()}>
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>{row.label}</DialogTitle>
              <DialogDescription>{row.help}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-1">
              {/* Who is named, in order (the signing order for signatories); x takes one off. */}
              <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5">
                {picked.length === 0 ? (
                  <span className="text-muted-foreground px-1 text-sm">Nobody named yet</span>
                ) : (
                  picked.map((id, i) => (
                    <Badge key={id} variant="secondary" className="gap-1 py-1 pr-1 pl-2 font-medium">
                      {row.key === "signatories" ? `${i + 1}. ` : ""}
                      {label(id)}
                      {canEdit ? (
                        <button type="button" className="hover:bg-muted rounded p-0.5" aria-label={`Remove ${label(id)}`} onClick={() => toggle(id)} disabled={busy}>
                          <X className="size-3" />
                        </button>
                      ) : null}
                    </Badge>
                  ))
                )}
              </div>
              {canEdit ? (
                <div className="grid gap-2">
                  <div className="relative">
                    <Search className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 my-auto size-4" />
                    <Input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search by name, email or role" className="ps-9" aria-label="Search people" disabled={busy} />
                  </div>
                  <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border" aria-label="People">
                    {shown.length === 0 ? (
                      <li className="text-muted-foreground px-3 py-4 text-center text-sm">No one found.</li>
                    ) : (
                      shown.map((u) => {
                        const on = picked.includes(u.id);
                        return (
                          <li key={u.id}>
                            {/* The whole row is the one toggle (a checkbox inside a label toggled twice). */}
                            <div
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`Name ${u.name}`}
                              tabIndex={busy ? -1 : 0}
                              onClick={() => !busy && toggle(u.id)}
                              onKeyDown={(ev) => {
                                if (busy || (ev.key !== " " && ev.key !== "Enter")) return;
                                ev.preventDefault();
                                toggle(u.id);
                              }}
                              className={`hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer items-center gap-3 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset ${on ? "bg-muted/40" : ""}`}
                            >
                              <Checkbox checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{u.name}</span>
                                {u.email ? <span className="text-muted-foreground block truncate text-xs">{u.email}</span> : null}
                              </span>
                              {u.role ? (
                                <Badge variant="outline" className="shrink-0 font-normal capitalize">
                                  {u.role.replace(/_/g, " ")}
                                </Badge>
                              ) : null}
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {canEdit
                  ? picked.length === 0
                    ? `Nobody named: ${row.fallback.charAt(0).toLowerCase()}${row.fallback.slice(1)}`
                    : `${picked.length} named. The change is recorded in Change history.`
                  : row.custom
                    ? "You can see this list; only an administrator can change it."
                    : "You can see this list, but changing it needs the right to edit these settings."}
              </p>
              {row.view && row.section ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs underline underline-offset-2"
                  onClick={() => onOpen(row)}
                >
                  All {VIEW_NAMES[row.view] ?? "related"} settings
                  <ArrowUpRight className="size-3" />
                </button>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} disabled={!canEdit || unchanged} onClick={() => void save()}>
                Save
              </SubmitButton>
            </DialogFooter>
          </>
        ) : null}
      </ActionDialogContent>
    </Dialog>
  );
}
