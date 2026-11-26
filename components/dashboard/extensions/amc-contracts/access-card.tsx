"use client";

import { useState } from "react";
import { FileText, KeyRound, Link2, Plus, ShieldCheck, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import DateSelect from "@/components/ui/date-select";
import type { DocumentLevel } from "@/lib/amc/client-profile";
import { amcRequest } from "@/lib/amc/http-cache";
import { ACCESS_STATUS_LABELS, type AccessStatus } from "@/lib/amc/visits";
import type { AccessRuleView, PassView } from "@/lib/server/amc/visits";
import { clientProfileService, type AccessRuleRecord } from "@/modules/amc-contracts/client-profile-service";

import { CompactEmpty, errorText } from "./call-out-shared";
import { ClientLinkButton } from "./client-link-button";
import { formatContractDate, formatDateTime } from "./contract-status";
import { PassTypeBadges, PassTypeFields, newPassType, passTypeOf, type PassType } from "./pass-fields";
import { AccessRuleDialog } from "./profile/property-panels";
import { useAmcData } from "./use-amc-data";
import { AccessRuleItem, ruleRecord } from "./visit-sections";
import { ACCESS_TONE } from "./visit-status";

/** What the card shows: the same for a site visit, a call out and an additional work. */
export type AccessCardData = {
  accessRules: AccessRuleView[];
  passes: PassView[];
  passTypes: boolean;
  status: AccessStatus;
  day: string;
  propertyId: string | null;
  canEdit: boolean;
};
type PassInput = { documentId: string; validUntil: string | null; note: string | null; accessRuleId?: string | null; accessStatus?: AccessStatus };

const siteVisitUrl = (id: string) => `/api/amc-contracts/assessments/${encodeURIComponent(id)}/passes`;

/** A site visit's access (17 Nov 2026): the shared card on the site visit's own route. */
export function SiteVisitAccessCard({ assessmentId }: { assessmentId: string }) {
  const { data, error, loading, reload } = useAmcData(() => amcRequest<AccessCardData>(siteVisitUrl(assessmentId)), `site-visit-access|${assessmentId}`);
  return (
    <AccessCard
      data={data}
      error={error}
      loading={loading}
      reload={reload}
      uploadLevel="site_visit"
      entityId={assessmentId}
      noun="site visit"
      who="inspector"
      /* DEV-494 on a site visit (26 Nov 2026): the client uploads the pass on a link. */
      clientLink={<ClientLinkButton siteVisitId={assessmentId} purpose="access_upload" label="Ask client for pass" icon={<Link2 className="size-4" />} size="sm" />}
      savePass={(input) => amcRequest(siteVisitUrl(assessmentId), { method: "PATCH", body: JSON.stringify(input) })}
      removePass={(documentId) => amcRequest(`${siteVisitUrl(assessmentId)}?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" })}
    />
  );
}

/**
 * Access as a planned visit has it (17 Nov 2026): what the property asks
 * for (its access rules, kept on the property for every visit there), then
 * the passes -- the record's own and the property's -- each with its
 * valid-until, access type and status. The status for the visit day is
 * worked out from them on the server.
 */
export function AccessCard({
  data,
  error,
  loading,
  reload,
  uploadLevel,
  entityId,
  noun,
  who,
  savePass,
  removePass,
  onChanged,
  clientLink,
}: {
  data: AccessCardData | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  uploadLevel: DocumentLevel;
  entityId: string;
  /** "site visit", "call out", "additional work". */
  noun: string;
  /** "inspector", "crew". */
  who: string;
  savePass: (input: PassInput) => Promise<unknown>;
  removePass: (documentId: string) => Promise<unknown>;
  /** After any change (the page's own figures). */
  onChanged?: () => void | Promise<void>;
  /** A client link button in the header (a site visit's pass upload link). */
  clientLink?: React.ReactNode;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [open, setOpen] = useState<"new" | PassView | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [passType, setPassType] = useState<PassType>({ ruleId: null, status: "pending", touched: false });
  const [busy, setBusy] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(0);
  const [editingRule, setEditingRule] = useState<AccessRuleRecord | null>(null);

  const rules = data?.accessRules ?? [];
  const passes = data?.passes ?? [];
  const canEdit = Boolean(data?.canEdit);
  const propertyId = data?.propertyId ?? null;
  const day = data?.day ?? "";

  const startAdd = () => {
    setFiles([]);
    setValidUntil("");
    setNote("");
    setPassType(newPassType(rules));
    setOpen("new");
  };
  const startEdit = (p: PassView) => {
    setValidUntil(p.expiresOn ?? "");
    setNote(p.notes ?? "");
    setPassType(passTypeOf(p));
    setOpen(p);
  };
  const openRule = (rule: AccessRuleRecord | null) => {
    setEditingRule(rule);
    setRuleOpen((n) => n + 1);
  };

  const save = async () => {
    setBusy(true);
    try {
      const type = data?.passTypes ? { accessRuleId: passType.ruleId, accessStatus: passType.status } : {};
      if (open === "new") {
        for (const file of files) {
          const { document } = await clientProfileService.uploadDocument({
            file,
            level: uploadLevel,
            entityId,
            category: "Gate pass",
            title: `Gate pass: ${file.name}`,
            expiresOn: validUntil || null,
            notes: note.trim() || null,
          });
          /* Its access type and status, or (before them) only to work the access out again. */
          await savePass({ documentId: document.id, validUntil: validUntil || null, note: note.trim() || null, ...type });
        }
        toast.success(files.length === 1 ? "Pass added" : `${files.length} passes added`);
      } else if (open) {
        await savePass({ documentId: open.id, validUntil: validUntil || null, note: note.trim() || null, ...type });
        toast.success("Pass saved");
      }
      setOpen(null);
      reload();
      await onChanged?.();
    } catch (e) {
      toast.error(errorText(e, "Could not save the pass."));
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: PassView) =>
    void confirm({
      title: `Remove ${p.fileName}?`,
      description: `It no longer counts for this ${noun}'s access. The file stays on record.`,
      confirmText: "Remove pass",
      action: async () => {
        await removePass(p.id);
        toast.success("Pass removed");
        reload();
        await onChanged?.();
      },
    });

  const openFile = async (id: string) => {
    try {
      const { url: fileUrl } = await clientProfileService.documentUrl(id);
      window.open(fileUrl, "_blank", "noopener");
    } catch (e) {
      toast.error(errorText(e, "Could not open the pass."));
    }
  };

  const shortDate = open !== null && Boolean(validUntil) && Boolean(day) && validUntil < day;

  return (
    <SectionCard
      icon={<ShieldCheck />}
      title="Access"
      description={`What the property asks for before the ${who} can get in, and the passes for this ${noun}. The property's own passes count here too.`}
      action={
        canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {propertyId ? (
              <Button size="sm" variant="outline" onClick={() => openRule(null)}>
                <KeyRound className="size-4" />
                Add rule
              </Button>
            ) : null}
            {clientLink ?? null}
            <Button size="sm" onClick={startAdd}>
              <Plus className="size-4" />
              Add pass
            </Button>
          </div>
        ) : null
      }
      bodyClassName="border-t"
    >
      {confirmDialog}
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the access" message={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <ListSkeleton rows={2} />
      ) : (
        <div className="grid gap-6 p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Access on {day ? formatContractDate(day) : "the visit day"}:</span>
            {data ? (
              <Badge variant="secondary" className={`border-0 font-medium ${ACCESS_TONE[data.status]}`}>
                {ACCESS_STATUS_LABELS[data.status]}
              </Badge>
            ) : null}
          </div>

          {/*
            Nothing asked and nothing on file (25 Nov 2026): one compact box,
            not two tall empty ones; otherwise each part, an empty one as one line.
          */}
          {rules.length === 0 && passes.length === 0 ? (
            /* The buttons are in the card's header only (26 Nov 2026: they showed twice). */
            <CompactEmpty icon={<ShieldCheck />} title="Nothing needed for access" description="This property asks for no pass or permit, and no pass is on file." />
          ) : (
            <>
              <div className="grid gap-2">
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium [&_svg]:size-3.5">
                  <KeyRound />
                  What the property needs {rules.length ? <span className="tabular-nums">({rules.length})</span> : null}
                  <span className="text-xs font-normal">Kept on the property, for every visit there.</span>
                </p>
                {rules.length === 0 ? (
                  <CompactEmpty title="No access rules" description="This property asks for no pass or permit." />
                ) : (
                  <ul className="grid gap-2">
                    {rules.map((r) => (
                      <AccessRuleItem key={r.id} rule={r} onEdit={canEdit && propertyId ? () => openRule(ruleRecord(r, propertyId)) : undefined} />
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-2">
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium [&_svg]:size-3.5">
                  <ShieldCheck />
                  Passes {passes.length ? <span className="tabular-nums">({passes.length})</span> : null}
                </p>
                {passes.length === 0 ? (
                  <CompactEmpty
                    title="No pass on file"
                    description="Add the gate pass or permit with how long it is valid. A pass on the property counts for every visit there."
                    action={
                      canEdit ? (
                        <Button size="sm" variant="outline" onClick={startAdd}>
                          <Plus className="size-4" />
                          Add pass
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <ul className="grid gap-2">
                    {passes.map((p) => {
                      const runsOut = p.expiresOn !== null && Boolean(day) && p.expiresOn < day;
                      const onProperty = p.level === "property";
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                          <span aria-hidden className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
                            <FileText className="size-4" />
                          </span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium" title={p.fileName}>
                                {p.fileName}
                              </span>
                              <Badge variant="secondary" className={`border-0 font-medium ${runsOut ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                                {p.expiresOn ? (runsOut ? `Ran out ${formatContractDate(p.expiresOn)}` : `Valid until ${formatContractDate(p.expiresOn)}`) : "No end date"}
                              </Badge>
                              {data?.passTypes ? <PassTypeBadges pass={p} rules={rules} /> : null}
                              {onProperty ? (
                                <Badge variant="outline" className="font-normal" title="Held by the property, for every visit there. Change it on the property's page.">
                                  Property pass
                                </Badge>
                              ) : null}
                            </span>
                            {p.notes ? <span className="text-sm whitespace-pre-wrap">{p.notes}</span> : null}
                            <span className="text-muted-foreground text-xs">
                              Added {formatDateTime(p.uploadedAt)}
                              {p.uploadedBy ? ` by ${p.uploadedBy}` : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => void openFile(p.id)}>
                              Open
                            </Button>
                            {canEdit && !onProperty ? (
                              <>
                                <Button size="icon" variant="ghost" className="size-8" title="Change the pass" aria-label={`Change ${p.fileName}`} onClick={() => startEdit(p)}>
                                  <SquarePen className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="text-destructive size-8" title="Remove the pass" aria-label={`Remove ${p.fileName}`} onClick={() => remove(p)}>
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {propertyId ? (
        <AccessRuleDialog
          key={ruleOpen}
          open={ruleOpen > 0}
          onOpenChange={(next) => !next && setRuleOpen(0)}
          initial={editingRule}
          onSave={async (input) => {
            if (editingRule) await clientProfileService.updateAccessRule(propertyId, editingRule.id, { ...input, active: editingRule.active });
            else await clientProfileService.addAccessRule(propertyId, input);
            await clientProfileService.refreshPropertyAccess(propertyId).catch(() => undefined);
            toast.success(editingRule ? "Access rule saved on the property" : "Access rule added to the property");
            setRuleOpen(0);
            setEditingRule(null);
            reload();
            await onChanged?.();
          }}
        />
      ) : null}

      <Dialog open={open !== null} onOpenChange={(next) => !busy && !next && setOpen(null)}>
        <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{open === "new" ? "Add pass" : "Change the pass"}</DialogTitle>
            <DialogDescription>{open && open !== "new" ? open.fileName : `The gate pass or permit for this ${noun}. Several files can share one date, type and note.`}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {open === "new" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="site-visit-pass-files">Files</Label>
                <Input id="site-visit-pass-files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                <p className="text-muted-foreground text-xs">{files.length ? files.map((f) => f.name).join(", ") : "Choose one or more: PDF or photos."}</p>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="site-visit-pass-until">Valid until (optional)</Label>
              <DateSelect id="site-visit-pass-until" value={validUntil} onChange={setValidUntil} />
              <p className={shortDate ? "text-warning text-xs" : "text-muted-foreground text-xs"}>
                {shortDate ? `Runs out before the visit (${formatContractDate(day)}).` : "Leave empty if it has no end date."}
              </p>
            </div>
            {data?.passTypes ? <PassTypeFields rules={rules} value={passType} onChange={setPassType} disabled={busy} /> : null}
            <div className="grid gap-1.5">
              <Label htmlFor="site-visit-pass-note">Note (optional)</Label>
              <Textarea id="site-visit-pass-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Gate number, who issued it, anything the ${who} should know`} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton onClick={() => void save()} pending={busy} pendingLabel={open === "new" ? "Uploading…" : "Saving…"} disabled={open === "new" && files.length === 0}>
              {open === "new" ? (files.length > 1 ? `Add ${files.length} passes` : "Add pass") : "Save pass"}
            </SubmitButton>
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </SectionCard>
  );
}
