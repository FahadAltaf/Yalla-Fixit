"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { CHANNEL_LABELS, LIFECYCLE_LABELS, PREFERRED_CHANNELS, UNIT_TYPES, UNIT_TYPE_CATEGORY, UNIT_TYPE_LABELS as UNIT_LABELS } from "@/lib/amc/client-profile";
import {
  amcContractsService,
  type CustomerInput,
  type CustomerRecord,
  type PropertyInput,
  type PropertyRecord,
} from "@/modules/amc-contracts/amc-contracts-service";

/** Search shared customers by name, Customer ID, phone or email and pick one. */
export function CustomerSearch({
  onPick,
  selectedId,
}: {
  onPick: (customer: CustomerRecord) => void;
  selectedId?: string | null;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CustomerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounce(q.trim(), 250);

  useEffect(() => {
    let stale = false;
    amcContractsService.customers(term).then(
      ({ customers }) => {
        if (stale) return;
        setResults(customers);
        setError(null);
      },
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not search customers."),
    );
    return () => {
      stale = true;
    };
  }, [term]);

  return (
    <div className="grid gap-2">
      <Input placeholder="Search name, Customer ID, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
        {results.length === 0 ? (
          <li className="text-muted-foreground px-3 py-2">{term ? "No customers match." : "No customers yet."}</li>
        ) : (
          results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className={`hover:bg-muted w-full px-3 py-2 text-left ${selectedId === c.id ? "bg-muted" : ""}`}
              >
                <span className="font-medium">{c.name}</span>
                {c.customerRef ? <span className="text-muted-foreground"> · {c.customerRef}</span> : null}
                <span className="text-muted-foreground block truncate text-xs">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** A customer's properties to pick from. */
export function PropertySelect({
  customerId,
  value,
  onChange,
  refreshKey = 0,
}: {
  customerId: string | null;
  value: string | null;
  onChange: (property: PropertyRecord | null) => void;
  refreshKey?: number;
}) {
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  useEffect(() => {
    if (!customerId) return;
    let stale = false;
    amcContractsService.customerProperties(customerId).then(
      ({ properties: list }) => !stale && setProperties(list),
      () => !stale && setProperties([]),
    );
    return () => {
      stale = true;
    };
  }, [customerId, refreshKey]);
  const list = customerId ? properties : [];
  return (
    <Select value={value ?? ""} onValueChange={(id) => onChange(list.find((p) => p.id === id) ?? null)} disabled={!customerId || list.length === 0}>
      <SelectTrigger aria-label="Property">
        <SelectValue placeholder={!customerId ? "Choose the customer first" : list.length ? "Choose a property" : "No properties yet"} />
      </SelectTrigger>
      <SelectContent>
        {list.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.label}
            {p.unitType ? ` · ${p.unitType}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CustomerFields({ value, onChange }: { value: CustomerInput; onChange: (next: CustomerInput) => void }) {
  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="cust-name">Name</Label>
        <Input id="cust-name" value={value.name} onChange={set("name")} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cust-ref">Customer ID</Label>
        <Input id="cust-ref" value={value.customerRef ?? ""} onChange={set("customerRef")} placeholder="e.g. YFI1806" maxLength={60} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cust-company">Company</Label>
        <Input id="cust-company" value={value.company ?? ""} onChange={set("company")} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cust-phone">Phone</Label>
        <Input id="cust-phone" value={value.phone ?? ""} onChange={set("phone")} maxLength={40} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cust-email">Email</Label>
        <Input id="cust-email" type="email" value={value.email ?? ""} onChange={set("email")} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label>Type</Label>
        <Select value={value.customerType ?? ""} onValueChange={(v) => onChange({ ...value, customerType: v as CustomerInput["customerType"] })}>
          <SelectTrigger aria-label="Type">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="company">Company</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label>Status</Label>
        <Select value={value.lifecycle ?? "client"} onValueChange={(v) => onChange({ ...value, lifecycle: v as CustomerInput["lifecycle"] })}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LIFECYCLE_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value.customerType === "company" ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="cust-licence">Trade licence no.</Label>
            <Input id="cust-licence" value={value.tradeLicenseNo ?? ""} onChange={set("tradeLicenseNo")} maxLength={60} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cust-licence-expiry">Licence expiry</Label>
            <Input id="cust-licence-expiry" type="date" value={value.tradeLicenseExpiry ?? ""} onChange={set("tradeLicenseExpiry")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cust-trn">TRN (15 digits)</Label>
            <Input id="cust-trn" inputMode="numeric" value={value.trn ?? ""} onChange={set("trn")} maxLength={15} />
          </div>
        </>
      ) : null}
      <div className="grid gap-1.5">
        <Label>Preferred channel</Label>
        <Select value={value.preferredChannel ?? ""} onValueChange={(v) => onChange({ ...value, preferredChannel: v as CustomerInput["preferredChannel"] })}>
          <SelectTrigger aria-label="Preferred channel">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {PREFERRED_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cust-language">Preferred language</Label>
        <Input id="cust-language" value={value.preferredLanguage ?? ""} onChange={set("preferredLanguage")} maxLength={40} placeholder="e.g. English, Arabic" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="cust-notes">Notes</Label>
        <Textarea id="cust-notes" rows={2} value={value.notes ?? ""} onChange={set("notes")} maxLength={2000} />
      </div>
    </div>
  );
}

export const UNIT_TYPE_LABELS = UNIT_LABELS;

export function PropertyFields({
  value,
  onChange,
  parentOptions = [],
}: {
  value: PropertyInput;
  onChange: (next: PropertyInput) => void;
  /** Properties this one can be linked under (combined units, BRD 5.2). */
  parentOptions?: Array<{ id: string; label: string }>;
}) {
  const text = (k: keyof PropertyInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="prop-label">Property</Label>
        <Input id="prop-label" value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="e.g. Villa 12, Street 4" maxLength={200} />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="prop-address">Address</Label>
        <Input id="prop-address" value={value.address ?? ""} onChange={(e) => onChange({ ...value, address: e.target.value })} maxLength={300} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="prop-community">Community</Label>
        <Input id="prop-community" value={value.community ?? ""} onChange={(e) => onChange({ ...value, community: e.target.value })} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label>Unit type</Label>
        <Select
          value={value.unitType ?? ""}
          onValueChange={(v) => {
            const unitType = v as NonNullable<PropertyInput["unitType"]>;
            /* Suggest the category the type usually belongs to, without overriding a choice. */
            onChange({ ...value, unitType, propertyCategory: value.propertyCategory ?? UNIT_TYPE_CATEGORY[unitType] ?? null });
          }}
        >
          <SelectTrigger aria-label="Unit type">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {UNIT_TYPES.map((k) => (
              <SelectItem key={k} value={k}>
                {UNIT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label>Category</Label>
        <Select value={value.propertyCategory ?? ""} onValueChange={(v) => onChange({ ...value, propertyCategory: v as PropertyInput["propertyCategory"] })}>
          <SelectTrigger aria-label="Category">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="residential">Residential</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="prop-bed">Bedrooms</Label>
          <Input
            id="prop-bed"
            type="number"
            min={0}
            value={value.bedrooms ?? ""}
            onChange={(e) => onChange({ ...value, bedrooms: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="prop-size">Size (sq ft)</Label>
          <Input
            id="prop-size"
            type="number"
            min={0}
            value={value.sizeSqft ?? ""}
            onChange={(e) => onChange({ ...value, sizeSqft: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="prop-building">Building / tower</Label>
        <Input id="prop-building" value={value.building ?? ""} onChange={text("building")} maxLength={200} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="prop-unit">Unit no.</Label>
          <Input id="prop-unit" value={value.unitNo ?? ""} onChange={text("unitNo")} maxLength={60} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="prop-floor">Floor</Label>
          <Input id="prop-floor" value={value.floor ?? ""} onChange={text("floor")} maxLength={30} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="prop-street">Street</Label>
        <Input id="prop-street" value={value.street ?? ""} onChange={text("street")} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="prop-city">City / emirate</Label>
        <Input id="prop-city" value={value.city ?? ""} onChange={text("city")} maxLength={80} placeholder="e.g. Dubai" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="prop-floors">Floors</Label>
          <Input
            id="prop-floors"
            type="number"
            min={0}
            value={value.floorsCount ?? ""}
            onChange={(e) => onChange({ ...value, floorsCount: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Occupied by</Label>
          <Select value={value.occupancy ?? ""} onValueChange={(v) => onChange({ ...value, occupancy: v as PropertyInput["occupancy"] })}>
            <SelectTrigger aria-label="Occupied by">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="tenant">Tenant</SelectItem>
              <SelectItem value="vacant">Vacant</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="prop-zones">Zones (comma separated)</Label>
        <Input
          id="prop-zones"
          value={(value.zones ?? []).join(", ")}
          onChange={(e) => onChange({ ...value, zones: e.target.value.split(",").map((z) => z.trimStart()) })}
          onBlur={(e) => onChange({ ...value, zones: e.target.value.split(",").map((z) => z.trim()).filter(Boolean) })}
          placeholder="e.g. Kitchen, Dining, Back of house"
        />
      </div>
      {parentOptions.length > 0 ? (
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Part of (combined units)</Label>
          <Select value={value.parentPropertyId ?? "none"} onValueChange={(v) => onChange({ ...value, parentPropertyId: v === "none" ? null : v })}>
            <SelectTrigger aria-label="Part of">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not linked</SelectItem>
              {parentOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">Linked, not merged: each unit keeps its own owner, billing and history.</p>
        </div>
      ) : null}
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="prop-access">Access constraints</Label>
        <Textarea id="prop-access" rows={2} value={value.accessConstraints ?? ""} onChange={text("accessConstraints")} maxLength={2000} placeholder="e.g. No work on Fridays; service lift only" />
      </div>
    </div>
  );
}

/** Empty strings become nulls before sending. */
export function cleanCustomer(input: CustomerInput): CustomerInput {
  const n = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    name: input.name.trim(),
    customerRef: n(input.customerRef),
    company: n(input.company),
    email: n(input.email),
    phone: n(input.phone),
    notes: n(input.notes),
    ...(input.customerType !== undefined ? { customerType: input.customerType || null } : {}),
    ...(input.lifecycle !== undefined ? { lifecycle: input.lifecycle } : {}),
    ...(input.tradeLicenseNo !== undefined ? { tradeLicenseNo: n(input.tradeLicenseNo) } : {}),
    ...(input.tradeLicenseExpiry !== undefined ? { tradeLicenseExpiry: input.tradeLicenseExpiry || null } : {}),
    ...(input.trn !== undefined ? { trn: n(input.trn) } : {}),
    ...(input.preferredChannel !== undefined ? { preferredChannel: input.preferredChannel || null } : {}),
    ...(input.preferredLanguage !== undefined ? { preferredLanguage: n(input.preferredLanguage) } : {}),
  };
}

export function cleanProperty(input: PropertyInput): PropertyInput {
  const n = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    ...input,
    label: input.label.trim(),
    address: n(input.address),
    community: n(input.community),
    notes: n(input.notes),
    ...(input.building !== undefined ? { building: n(input.building) } : {}),
    ...(input.unitNo !== undefined ? { unitNo: n(input.unitNo) } : {}),
    ...(input.floor !== undefined ? { floor: n(input.floor) } : {}),
    ...(input.street !== undefined ? { street: n(input.street) } : {}),
    ...(input.city !== undefined ? { city: n(input.city) } : {}),
    ...(input.zones !== undefined ? { zones: input.zones.map((z) => z.trim()).filter(Boolean) } : {}),
    ...(input.accessConstraints !== undefined ? { accessConstraints: n(input.accessConstraints) } : {}),
  };
}

export function SubmitRow({ busy, label, onClick, disabled }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button onClick={onClick} disabled={busy || disabled}>
      {busy ? "Saving…" : label}
    </Button>
  );
}
