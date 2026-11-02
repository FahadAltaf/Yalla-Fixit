"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, ArchiveRestore, Eye, EyeOff, Pencil, RefreshCw, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState, FieldsSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { complianceService, type ComplianceDocument, type EmployeeRecord } from "@/modules/compliance";
import { ItemDocuments } from "./item-documents";
import { EMPLOYMENT_STATUS_LABEL } from "@/lib/compliance/statuses";
import { maskedDisplay } from "@/lib/compliance/masking";
import { formatZonedDate, formatZonedDateTime, formatZonedTime } from "@/lib/scheduling/org-time";
import { EmployeeForm } from "./employee-form";
import { StatusPill, formatDateOnly } from "./status-pill";
import { useComplianceRights } from "./use-rights";

/**
 * One employee's compliance record (FRD FR-1, FR-4, FR-6, FR-14, D11).
 * Numbers are masked. Archive is refused for a technician still active
 * in FSM; Deactivate sends the FSM request instead and says so.
 */
/** embedded: shown as the Compliance tab of a Workforce person (C6), so no back link. */
export default function EmployeeRecordView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const { rights } = useComplianceRights();
  const { confirm, dialog } = useConfirm();
  const [record, setRecord] = useState<EmployeeRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshRoster = async () => {
    setRefreshing(true);
    try {
      await complianceService.refreshRoster();
      await load();
      toast.success("Roster refreshed from FSM");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh from FSM");
    } finally {
      setRefreshing(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecord(await complianceService.getEmployee(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the employee");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* C2: certificate files, only for holders of the identity right (the API refuses everyone else). */
  const [documents, setDocuments] = useState<ComplianceDocument[]>([]);
  const loadDocuments = useCallback(async () => {
    if (!rights.full_numbers) return;
    try {
      setDocuments(await complianceService.documents(id));
    } catch {
      setDocuments([]);
    }
  }, [id, rights.full_numbers]);
  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  // Arriving from the reminder list with #doc-<item>: bring that certificate into view once loaded.
  useEffect(() => {
    if (!record || typeof window === "undefined" || !window.location.hash.startsWith("#doc-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [record, documents]);

  const archive = async (archived: boolean) => {
    if (!record) return;
    const ok = await confirm({
      title: archived ? "Archive this employee?" : "Restore this employee?",
      description: archived ? "The record is kept but leaves every list, count and reminder. Nothing is deleted." : "The record returns to the lists and counts.",
      confirmText: archived ? "Archive" : "Restore",
      variant: archived ? "destructive" : "default",
      action: async () => {
        const saved = await complianceService.setArchived(record.id, archived);
        setRecord(saved);
      },
    });
    if (ok) toast.success(archived ? "Employee archived" : "Employee restored");
  };

  const sendDeactivation = async () => {
    if (!record) return;
    setSending(true);
    try {
      const result = await complianceService.requestDeactivation(record.id, note || null);
      setDeactivateOpen(false);
      setNote("");
      toast.success(`Request sent to ${result.recipients.join(", ")}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setSending(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => void load()} retrying={loading} />;
  if (loading || !record) return <FieldsSkeleton />;

  if (editing) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading eyebrow="Manpower compliance" title={`Edit ${record.full_name}`} description={`Employee ID ${record.maher_id}`} actions={<Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>} />
        <EmployeeForm
          record={record}
          onSaved={(saved) => {
            setRecord(saved);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  const linkedActive = Boolean(record.technician?.is_active);

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <PageHeading
        eyebrow="Manpower compliance"
        // Inside a Workforce profile the name is already the page title.
        title={embedded ? "Compliance record" : record.full_name}
        description={`Employee ID ${record.maher_id}${record.designation ? ` · ${record.designation.name}` : ""}${record.archived_at ? " · archived" : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {embedded ? null : (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/workforce/${record.id}`}>
                  <ArrowLeft className="size-4" /> Workforce profile
                </Link>
              </Button>
            )}
            {rights.edit && record.technician ? (
              <Button variant="outline" size="sm" onClick={() => void refreshRoster()} disabled={refreshing} title="Pull the technician roster from Zoho FSM now">
                <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /> Refresh from FSM
              </Button>
            ) : null}
            {rights.edit && !record.archived_at ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            ) : null}
            {rights.edit && linkedActive && !record.archived_at ? (
              <Button variant="outline" size="sm" onClick={() => setDeactivateOpen(true)}>
                <UserRoundX className="size-4" /> Deactivate
              </Button>
            ) : null}
            {rights.archive && !record.archived_at && record.can_archive ? (
              <Button variant="destructive" size="sm" onClick={() => void archive(true)}>
                <Archive className="size-4" /> Archive
              </Button>
            ) : null}
            {rights.archive && record.archived_at ? (
              <Button variant="outline" size="sm" onClick={() => void archive(false)}>
                <ArchiveRestore className="size-4" /> Restore
              </Button>
            ) : null}
          </div>
        }
      />

      {record.employment_status_source === "fsm" ? (
        <p className="border-warning/40 bg-warning/5 rounded-md border px-3 py-2 text-sm">
          FSM shows this technician as inactive{record.employment_status_since ? ` since ${formatZonedDate(record.employment_status_since)}` : ""}. The employment status follows FSM.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <SectionCard title="Identity documents" description={rights.full_numbers ? "Last four characters shown. Each time you reveal a full number it is recorded." : "Last four characters only. Full numbers need a separate right."} bodyClassName="px-5 pb-5">
            <div className="grid gap-4 md:grid-cols-2">
              <IdentityPanel label="Emirates ID" item={record.emirates_id} length={15} employeeId={record.id} field="emirates_id" canReveal={rights.full_numbers} />
              <IdentityPanel label="Passport" item={record.passport} length={9} employeeId={record.id} field="passport" canReveal={rights.full_numbers} />
            </div>
          </SectionCard>

          <SectionCard title="Training certificates" description="Every type is listed; a type the employee does not hold shows Not held." bodyClassName="px-5 pb-5">
            <ul className="divide-y">
              {record.certificates.map((c) => (
                <li key={c.certificate_type_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {c.name}
                    {!c.is_active ? <span className="text-muted-foreground text-xs"> · retired type, kept because it is held</span> : null}
                    {!c.expires ? <span className="text-muted-foreground text-xs"> · does not expire</span> : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{c.held ? (c.expires ? formatDateOnly(c.expiry_date) : "Held") : "—"}</span>
                    <StatusPill status={c.status} days={c.days} />
                  </span>
                  {rights.full_numbers && c.held ? (
                    <div className="w-full">
                      <ItemDocuments
                        employeeId={record.id}
                        itemKey={`cert:${c.certificate_type_id}`}
                        expiryDate={c.expiry_date}
                        documents={documents.filter((d) => d.item_key === `cert:${c.certificate_type_id}`)}
                        canUpload={rights.edit && !record.archived_at}
                        onChanged={() => void loadDocuments()}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
              {!record.certificates.length ? <li className="text-muted-foreground py-2 text-sm">No certificate types defined yet.</li> : null}
            </ul>
          </SectionCard>

          {record.remarks ? (
            <SectionCard title="Remarks" bodyClassName="px-5 pb-5">
              <p className="text-sm whitespace-pre-wrap">{record.remarks}</p>
            </SectionCard>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <SectionCard title="Nearest expiry" bodyClassName="px-5 pb-5">
            {record.nearest_expiry ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{record.nearest_expiry.label}</span>
                <span className="text-muted-foreground text-sm">{formatDateOnly(record.nearest_expiry.expiry)}</span>
                <StatusPill status={record.nearest_expiry.status} days={record.nearest_expiry.days} className="w-fit" />
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">None</span>
            )}
          </SectionCard>
          <SectionCard title="Employment" bodyClassName="px-5 pb-5">
            <dl className="flex flex-col divide-y text-sm">
              <Field label="Status" value={EMPLOYMENT_STATUS_LABEL[record.employment_status]} />
              <Field label="Designation" value={record.designation?.name ?? "—"} />
              <Field label="Nationality" value={record.nationality?.name ?? "—"} />
              <Field label="Joined" value={formatDateOnly(record.date_of_joining)} />
              <Field label="Site" value={record.site ? [record.site.client_name, record.site.property_label].filter(Boolean).join(" · ") : "Unassigned"} />
              <Field
                label="Site source"
                value={
                  record.site?.source === "fsm"
                    ? `FSM appointment${record.site.appointment_start ? ` ${formatZonedTime(record.site.appointment_start)}–${record.site.appointment_end ? formatZonedTime(record.site.appointment_end) : ""}` : ""}`
                    : record.site?.source === "manual"
                      ? "Entered by hand (before FSM sites)"
                      : record.technician
                        ? "No appointment in progress"
                        : "Not linked to FSM"
                }
              />
              {record.site?.source === "fsm" ? (
                <Field
                  label="Appointment"
                  value={[record.site.appointment_name ?? record.site.appointment_id, record.site.work_order_name ? `work order ${record.site.work_order_name}` : null].filter(Boolean).join(" · ") || "Not given by FSM"}
                />
              ) : null}
              <Field label="Site checked" value={record.site_synced_at ? formatZonedDateTime(record.site_synced_at) : "Not yet"} />
              <Field label="FSM technician" value={record.technician ? `${record.technician.display_name}${record.technician.is_active ? "" : " (inactive)"}` : "Not linked"} />
            </dl>
          </SectionCard>
        </div>
      </div>

      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivation is done in FSM</DialogTitle>
            <DialogDescription>
              Technicians are deactivated in Zoho FSM, not in the portal. This sends a request to the people who can do that; the record changes to Inactive once FSM shows the technician inactive.
            </DialogDescription>
          </DialogHeader>
          <Textarea id="deactivation-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the request (optional)" rows={3} maxLength={500} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <SubmitButton pending={sending} pendingLabel="Sending…" onClick={() => void sendDeactivation()}>
              Send request
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function IdentityPanel({
  label,
  item,
  length,
  employeeId,
  field,
  canReveal,
}: {
  label: string;
  item: EmployeeRecord["emirates_id"];
  length: number;
  employeeId: string;
  field: "emirates_id" | "passport";
  canReveal: boolean;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  /*
    The full number lives in this component's state only while shown, is
    never written to the URL, storage or the console, and is cleared on
    Hide. Every reveal is a POST the server audits before answering.
  */
  const reveal = async () => {
    setRevealing(true);
    try {
      const result = await complianceService.revealIdentity(employeeId, field);
      setFull(result.value ?? "Not entered");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reveal the number");
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{full ?? maskedDisplay(item, length)}</span>
        {canReveal && item.present ? (
          full ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setFull(null)}>
              <EyeOff className="size-4" /> Hide
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => void reveal()} disabled={revealing}>
              <Eye className="size-4" /> {revealing ? "Revealing…" : "Show"}
            </Button>
          )
        ) : null}
      </span>
      <span className="text-muted-foreground text-sm">Expires {formatDateOnly(item.expiry)}</span>
      <StatusPill status={item.status} days={item.days} className="w-fit" />
    </div>
  );
}
