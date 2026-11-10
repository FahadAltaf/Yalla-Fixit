"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { ComplianceApiError, complianceService, type CertificateType, type EmployeeRecord, type LookupOption } from "@/modules/compliance";
import { EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUSES, type ComplianceEmploymentStatus } from "@/lib/compliance/statuses";
import { emiratesIdNotice } from "@/lib/compliance/validation";
import { maskedDisplay, normaliseEmiratesId } from "@/lib/compliance/masking";
import type { EmployeeInput } from "@/lib/compliance/validation";
import type { SiteValue } from "./site-picker";
import { TechnicianLinkPicker } from "./technician-link-picker";

type CertState = { certificate_type_id: string; held: boolean; expiry_date: string };

type FormState = {
  maher_id: string;
  full_name: string;
  designation_id: string;
  nationality_id: string;
  date_of_joining: string;
  employment_status: ComplianceEmploymentStatus;
  site: SiteValue;
  fsm_resource_id: string | null;
  technician_name: string | null;
  remarks: string;
  emirates_id_number: string;
  emirates_id_expiry: string;
  passport_number: string;
  passport_expiry: string;
  certificates: CertState[];
};

function fromRecord(r: EmployeeRecord | null, types: CertificateType[]): FormState {
  const held = new Map((r?.certificates ?? []).map((c) => [c.certificate_type_id, c]));
  return {
    maher_id: r?.maher_id ?? "",
    full_name: r?.full_name ?? "",
    designation_id: r?.designation?.id ?? "",
    nationality_id: r?.nationality?.id ?? "",
    date_of_joining: r?.date_of_joining ?? "",
    employment_status: r?.stored_employment_status ?? "active",
    site: r?.site
      ? { site_client_id: r.site.client_id, site_property_id: r.site.property_id, client_name: r.site.client_name, property_label: r.site.property_label }
      : { site_client_id: null, site_property_id: null, client_name: null, property_label: null },
    fsm_resource_id: r?.technician?.fsm_resource_id ?? null,
    technician_name: r?.technician?.display_name ?? null,
    remarks: r?.remarks ?? "",
    emirates_id_number: "",
    emirates_id_expiry: r?.emirates_id.expiry ?? "",
    passport_number: "",
    passport_expiry: r?.passport.expiry ?? "",
    certificates: types
      .filter((t) => t.is_active || held.has(t.id))
      .map((t) => ({ certificate_type_id: t.id, held: held.get(t.id)?.held ?? false, expiry_date: held.get(t.id)?.expiry_date ?? "" })),
  };
}

/*
  The required mark, as the AMC and Snagging forms draw it: only on fields
  that can actually be left blank. A select that opens with a value is
  required too, and marking it would make the mark mean nothing.
*/
function RequiredMark() {
  return (
    <span className="text-brand" aria-hidden>
      {" *"}
    </span>
  );
}

/** Fields the form insists on (FRD data dictionary). The API accepts nulls for the import. */
const REQUIRED: { key: keyof FormState; label: string }[] = [
  { key: "maher_id", label: "Employee ID (Maher ID)" },
  { key: "full_name", label: "Full name" },
  { key: "designation_id", label: "Designation" },
  { key: "nationality_id", label: "Nationality" },
  { key: "date_of_joining", label: "Date of joining" },
  { key: "employment_status", label: "Employment status" },
];

/**
 * Create or edit an employee (FRD FR-1, FR-2). Identity numbers are
 * write-only: the field shows the masked value on file and only sends a
 * new number when one is typed. Clearing uses the explicit button.
 */
export function EmployeeForm({ record, onSaved }: { record: EmployeeRecord | null; onSaved: (saved: EmployeeRecord) => void }) {
  const [types, setTypes] = useState<CertificateType[]>([]);
  const [designations, setDesignations] = useState<LookupOption[]>([]);
  const [nationalities, setNationalities] = useState<LookupOption[]>([]);
  const [form, setForm] = useState<FormState>(() => fromRecord(record, []));
  const [clearEid, setClearEid] = useState(false);
  const [clearPassport, setClearPassport] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([complianceService.certificateTypes(true), complianceService.listOptions("designation"), complianceService.listOptions("nationality")])
      .then(([t, d, n]) => {
        if (!alive) return;
        setTypes(t);
        setDesignations(d);
        setNationalities(n);
        setForm(fromRecord(record, t));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load the lists"))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [record]);

  const allowedStatuses = record?.allowed_statuses ?? EMPLOYMENT_STATUSES;
  const eidNotice = useMemo(() => emiratesIdNotice(form.emirates_id_number ? normaliseEmiratesId(form.emirates_id_number) : null), [form.emirates_id_number]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setCert = (id: string, patch: Partial<CertState>) =>
    setForm((f) => ({ ...f, certificates: f.certificates.map((c) => (c.certificate_type_id === id ? { ...c, ...patch, ...(patch.held === false ? { expiry_date: "" } : {}) } : c)) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    for (const f of REQUIRED) {
      if (!String(form[f.key] ?? "").trim()) missing[f.key] = `${f.label} is required`;
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      toast.error("Fill in the required fields");
      return;
    }
    setSaving(true);
    setErrors({});
    const certificates = form.certificates.map((c) => ({ certificate_type_id: c.certificate_type_id, held: c.held, expiry_date: c.held && c.expiry_date ? c.expiry_date : null }));
    try {
      let saved: EmployeeRecord;
      if (!record) {
        const body: EmployeeInput = {
          maher_id: form.maher_id,
          full_name: form.full_name,
          designation_id: form.designation_id || null,
          nationality_id: form.nationality_id || null,
          date_of_joining: form.date_of_joining || null,
          employment_status: form.employment_status,
          site_client_id: form.site.site_client_id,
          site_property_id: form.site.site_property_id,
          fsm_resource_id: form.fsm_resource_id,
          remarks: form.remarks || null,
          identity: {
            emirates_id_number: form.emirates_id_number || null,
            emirates_id_expiry: form.emirates_id_expiry || null,
            passport_number: form.passport_number || null,
            passport_expiry: form.passport_expiry || null,
          },
          certificates,
        };
        saved = await complianceService.createEmployee(body);
        toast.success("Employee created");
      } else {
        const identity: Record<string, string | null> = {
          emirates_id_expiry: form.emirates_id_expiry || null,
          passport_expiry: form.passport_expiry || null,
        };
        if (clearEid) identity.emirates_id_number = null;
        else if (form.emirates_id_number) identity.emirates_id_number = form.emirates_id_number;
        if (clearPassport) identity.passport_number = null;
        else if (form.passport_number) identity.passport_number = form.passport_number;
        saved = await complianceService.updateEmployee(record.id, {
          maher_id: form.maher_id,
          full_name: form.full_name,
          designation_id: form.designation_id || null,
          nationality_id: form.nationality_id || null,
          date_of_joining: form.date_of_joining || null,
          employment_status: form.employment_status,
          site_client_id: form.site.site_client_id,
          site_property_id: form.site.site_property_id,
          fsm_resource_id: form.fsm_resource_id,
          remarks: form.remarks || null,
          identity,
          certificates,
        });
        toast.success("Employee updated");
      }
      onSaved(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      if (err instanceof ComplianceApiError && Object.keys(err.fields).length) setErrors(err.fields);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return <p className="text-muted-foreground text-sm">Loading…</p>;

  const fieldError = (key: string) => (errors[key] ? <p className="text-danger text-xs">{errors[key]}</p> : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <SectionCard title="Employee" description="Identity and employment. Employee ID is the Maher ID. Fields marked * are required." bodyClassName="px-5 pb-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-maher-id">Employee ID (Maher ID)<RequiredMark /></Label>
            <Input id="emp-maher-id" value={form.maher_id} onChange={(e) => set("maher_id", e.target.value)} required aria-required />
            {fieldError("maher_id")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-name">Full name<RequiredMark /></Label>
            <Input id="emp-name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} required aria-required />
            {fieldError("full_name")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-designation">Designation<RequiredMark /></Label>
            <Select value={form.designation_id || "none"} onValueChange={(v) => set("designation_id", v === "none" ? "" : v)}>
              <SelectTrigger id="emp-designation">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {designations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!designations.length ? <p className="text-muted-foreground text-xs">Add designations under Settings → Compliance.</p> : null}
            {fieldError("designation_id")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-nationality">Nationality<RequiredMark /></Label>
            <Select value={form.nationality_id || "none"} onValueChange={(v) => set("nationality_id", v === "none" ? "" : v)}>
              <SelectTrigger id="emp-nationality">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {nationalities.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError("nationality_id")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-doj">Date of joining<RequiredMark /></Label>
            <Input id="emp-doj" type="date" value={form.date_of_joining} onChange={(e) => set("date_of_joining", e.target.value)} required aria-required />
            {fieldError("date_of_joining")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-status">Employment status<RequiredMark /></Label>
            <Select value={form.employment_status} onValueChange={(v) => set("employment_status", v as ComplianceEmploymentStatus)}>
              <SelectTrigger id="emp-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} disabled={!allowedStatuses.includes(s)}>
                    {EMPLOYMENT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {record?.technician?.is_active ? <p className="text-muted-foreground text-xs">Linked to an active FSM technician: leaving is recorded in FSM first. Use Deactivate on the record.</p> : null}
            {fieldError("employment_status")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Current site</Label>
            {/* C3: never typed. It is the client of the FSM appointment the linked technician is on now. */}
            <p className="text-muted-foreground text-sm">
              {record?.site?.source === "fsm"
                ? `${record.site.client_name}${record.site.property_label ? ` · ${record.site.property_label}` : ""} (from FSM)`
                : "Set from FSM: the client of the appointment the linked technician is on now. Blank when there is none."}
            </p>
            {fieldError("site_property_id")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>FSM technician</Label>
            <TechnicianLinkPicker
              value={form.fsm_resource_id}
              displayName={form.technician_name}
              onChange={(id, name) => {
                set("fsm_resource_id", id);
                set("technician_name", name);
              }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Identity documents" description="Numbers are stored in full but shown to the last four characters only." bodyClassName="px-5 pb-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-eid">Emirates ID number</Label>
            {record ? <p className="text-muted-foreground font-mono text-xs">On file: {clearEid ? "will be cleared" : maskedDisplay(record.emirates_id, 15)}</p> : null}
            <Input id="emp-eid" value={form.emirates_id_number} onChange={(e) => set("emirates_id_number", e.target.value)} placeholder={record ? "Type a new number to replace" : "784-XXXX-XXXXXXX-X"} inputMode="numeric" disabled={clearEid} />
            {eidNotice ? <p className="text-warning text-xs">{eidNotice}</p> : null}
            {fieldError("identity.emirates_id_number")}
            {record?.emirates_id.present ? (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" id="emp-eid-clear" checked={clearEid} onChange={(e) => setClearEid(e.target.checked)} /> Clear the number on file
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-eid-expiry">Emirates ID expiry</Label>
            <Input id="emp-eid-expiry" type="date" value={form.emirates_id_expiry} onChange={(e) => set("emirates_id_expiry", e.target.value)} />
            {fieldError("identity.emirates_id_expiry")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-passport">Passport number</Label>
            {record ? <p className="text-muted-foreground font-mono text-xs">On file: {clearPassport ? "will be cleared" : maskedDisplay(record.passport, 9)}</p> : null}
            <Input id="emp-passport" value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} placeholder={record ? "Type a new number to replace" : "Letters and digits"} disabled={clearPassport} />
            {fieldError("identity.passport_number")}
            {record?.passport.present ? (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" id="emp-passport-clear" checked={clearPassport} onChange={(e) => setClearPassport(e.target.checked)} /> Clear the number on file
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-passport-expiry">Passport expiry</Label>
            <Input id="emp-passport-expiry" type="date" value={form.passport_expiry} onChange={(e) => set("passport_expiry", e.target.value)} />
            {fieldError("identity.passport_expiry")}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Training certificates" description="Held and expiry per certificate type. A type that does not expire needs no date." bodyClassName="px-5 pb-5">
        {!types.length ? (
          <p className="text-muted-foreground text-sm">No certificate types yet. Add them under Settings → Compliance.</p>
        ) : (
          <div className="flex flex-col divide-y">
            {form.certificates.map((c) => {
              const type = types.find((t) => t.id === c.certificate_type_id);
              if (!type) return null;
              return (
                <div key={c.certificate_type_id} className="grid items-center gap-3 py-3 md:grid-cols-[1fr_auto_200px]">
                  <div>
                    <span className="font-medium">{type.name}</span>
                    {!type.is_active ? <span className="text-muted-foreground text-xs"> · retired</span> : null}
                    {!type.expires ? <span className="text-muted-foreground text-xs"> · does not expire</span> : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm" htmlFor={`cert-held-${c.certificate_type_id}`}>
                    <Switch id={`cert-held-${c.certificate_type_id}`} checked={c.held} onCheckedChange={(held) => setCert(c.certificate_type_id, { held })} />
                    {c.held ? "Held" : "Not held"}
                  </label>
                  {type.expires ? (
                    <Input id={`cert-expiry-${c.certificate_type_id}`} type="date" value={c.expiry_date} onChange={(e) => setCert(c.certificate_type_id, { expiry_date: e.target.value })} disabled={!c.held} aria-label={`${type.name} expiry`} />
                  ) : (
                    <span className="text-muted-foreground text-sm">No expiry</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Remarks" bodyClassName="px-5 pb-5">
        <Textarea id="emp-remarks" value={form.remarks} onChange={(e) => set("remarks", e.target.value)} rows={4} maxLength={10_000} />
      </SectionCard>

      <div className="flex justify-end gap-2">
        <SubmitButton type="submit" pending={saving} pendingLabel="Saving…">
          {record ? "Save changes" : "Create employee"}
        </SubmitButton>
      </div>
    </form>
  );
}
