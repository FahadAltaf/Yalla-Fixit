"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Download,
  FileText,
  MapPin,
  Pencil,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { compressImage } from "@/lib/media/compress-image";
import { cn } from "@/lib/utils";
import { snaggingService, type SnaggingClientOption } from "@/modules/snagging";
import type { SnaggingProperty, SnaggingPropertyType } from "@/types/types";

import { LocationPicker } from "./location-picker";
import {
  DataRow,
  ErrorState,
  PROPERTY_TYPE_LABELS,
  SubmitButton,
} from "./shared";

/**
 * A client's addresses: the units they have on file.
 *
 * An address was only ever written as a side effect of raising a quotation
 * or a job, and nothing showed it afterwards. So the Clients page listed
 * people with no sign of where they lived, and a client who rang back for
 * a second quotation had their address typed in again. Here the addresses
 * are listed against the client, and one can be added or corrected before
 * any document exists -- the quotation and job forms then fill it in when
 * the client is picked.
 *
 * An address is a property record (snagging_properties), the same one the
 * job and the quotation point at, so correcting it here corrects it there.
 * Everything that record holds is shown and can be changed: the unit, its
 * size, where it is on the map, and its paperwork.
 */
export function ClientAddressesDialog({
  client,
  canEdit,
  onClose,
  onChanged,
}: {
  client: SnaggingClientOption | null;
  canEdit: boolean;
  onClose: () => void;
  /** An address was added or changed, so the table's count is stale. */
  onChanged: () => void;
}) {
  const clientId = client?.id ?? null;
  const [rows, setRows] = useState<SnaggingProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The address in the form: a saved one, "new", or none (the list). */
  const [editing, setEditing] = useState<SnaggingProperty | "new" | null>(null);

  // A clean list whenever another client opens.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (clientId !== shownFor) {
    setShownFor(clientId);
    setRows([]);
    setError(null);
    setEditing(null);
    setLoading(Boolean(clientId));
  }

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await snaggingService.listProperties(clientId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the addresses",
      );
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Dialog open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">
            {client?.client_name ?? "Client"} · addresses
          </DialogTitle>
          <DialogDescription>
            The units this client has on file. Picking the client on a quotation
            or a job fills in the newest one, so it is not typed again.
          </DialogDescription>
        </DialogHeader>

        {/*
          The list scrolls as one. The form scrolls inside itself instead,
          so its Save bar sits outside the scrolling part: a bar stuck to
          the bottom of the same scroller had the map sliding under it and
          showing through below.
        */}
        <div
          className={cn(
            "min-h-0 flex-1 border-t",
            editing
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto px-6 py-4",
          )}
        >
          {editing && clientId ? (
            <AddressForm
              key={editing === "new" ? "new" : editing.id}
              clientId={clientId}
              address={editing === "new" ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void load();
                onChanged();
              }}
            />
          ) : error ? (
            <ErrorState
              title="Could not load the addresses"
              message={error}
              onRetry={() => void load()}
              retrying={loading}
            />
          ) : loading ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-20 w-full rounded-lg" />
            </div>
          ) : (
            <div className="space-y-4">
              {rows.length === 0 ? (
                <EmptyState
                  icon={<MapPin />}
                  title="No address on file"
                  description="Add one now, or it will be saved with this client's first quotation."
                />
              ) : (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {rows.map((row) => (
                    <DataRow
                      key={row.id}
                      className="items-start py-3"
                      icon={<Building2 aria-hidden />}
                      title={addressTitle(row)}
                      subtitle={<AddressSummary row={row} />}
                      trailing={
                        canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setEditing(row)}
                            aria-label={`Edit ${addressTitle(row)}`}
                            title="Edit address"
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </div>
              )}

              {canEdit ? (
                <Button variant="outline" onClick={() => setEditing("new")}>
                  <Plus className="size-4" />
                  Add address
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Unit 1904, Riviera Tower 3": the line a coordinator recognises the unit by. */
function addressTitle(row: SnaggingProperty): string {
  return (
    [row.unit_label, row.building_name].filter(Boolean).join(", ") ||
    "Unnamed unit"
  );
}

const sqft = (value: number | null | undefined) =>
  value ? `${Number(value).toLocaleString("en-US")} sq ft` : null;

/**
 * Everything the record holds, read without opening it: where and what the
 * unit is, how big, then the map pin and the paperwork as small tags -- the
 * things somebody checks before deciding whether the address needs editing.
 */
function AddressSummary({ row }: { row: SnaggingProperty }) {
  const beds =
    row.property_type === "commercial" || row.bedrooms == null
      ? null
      : row.bedrooms === 0
        ? "Studio"
        : `${row.bedrooms} bed`;
  const builtUp = sqft(row.built_up_area_sqft);
  const plot = sqft(row.plot_area_sqft);
  const facts = [
    row.community,
    PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
    beds,
    builtUp ? `${builtUp} built-up` : null,
    plot ? `${plot} plot` : null,
    row.floors ? `${row.floors} floor${row.floors === 1 ? "" : "s"}` : null,
    row.developer_name ? `by ${row.developer_name}` : null,
  ].filter(Boolean);
  const pinned = row.location_lat != null && row.location_lng != null;

  return (
    // The row's subtitle is one truncated line by default; this one wraps.
    <span className="block space-y-1.5 whitespace-normal">
      <span className="block">{facts.join(" · ")}</span>
      <span className="flex flex-wrap gap-1.5">
        <Tag on={pinned}>{pinned ? "Location pinned" : "No location pin"}</Tag>
        {row.external_areas_in_scope ? (
          <Tag on>External areas in scope</Tag>
        ) : null}
        <Tag on={Boolean(row.title_deed_path)}>
          {row.title_deed_path ? "Title deed on file" : "No title deed"}
        </Tag>
        {row.noc_required || row.noc_path ? (
          <Tag on={Boolean(row.noc_path)} warn={!row.noc_path}>
            {row.noc_path ? "NOC on file" : "NOC required, missing"}
          </Tag>
        ) : null}
      </span>
    </span>
  );
}

function Tag({
  on,
  warn,
  children,
}: {
  on?: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-0 font-medium",
        warn
          ? "bg-warning/10 text-warning"
          : on
            ? "bg-success/10 text-success"
            : "bg-mist text-ink-soft",
      )}
    >
      {children}
    </Badge>
  );
}

/**
 * Add an address, or correct one: the whole property record.
 *
 * The same fields the quotation and job forms ask for, because it is the
 * same record -- an address kept here that was missing its size or its pin
 * would only have to be finished on the quotation anyway. Only the unit
 * reference is required; the rest is filled in as it becomes known.
 */
function AddressForm({
  clientId,
  address,
  onCancel,
  onSaved,
}: {
  clientId: string;
  address: SnaggingProperty | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const text = (value: number | null | undefined) =>
    value != null ? String(value) : "";
  const [unit, setUnit] = useState(address?.unit_label ?? "");
  const [building, setBuilding] = useState(address?.building_name ?? "");
  const [community, setCommunity] = useState(address?.community ?? "");
  const [developer, setDeveloper] = useState(address?.developer_name ?? "");
  const [type, setType] = useState<SnaggingPropertyType>(
    address?.property_type ?? "apartment",
  );
  const [bedrooms, setBedrooms] = useState(address?.bedrooms ?? 1);
  const [builtUp, setBuiltUp] = useState(text(address?.built_up_area_sqft));
  const [plot, setPlot] = useState(text(address?.plot_area_sqft));
  const [floors, setFloors] = useState(text(address?.floors));
  const [external, setExternal] = useState(
    Boolean(address?.external_areas_in_scope),
  );
  // Strings, so a half-typed coordinate is not destroyed while it is typed.
  const [lat, setLat] = useState(text(address?.location_lat));
  const [lng, setLng] = useState(text(address?.location_lng));
  const [nocRequired, setNocRequired] = useState(
    Boolean(address?.noc_required),
  );
  // Picked here, uploaded with the save (a new address has no id until then).
  const [deedFile, setDeedFile] = useState<File | null>(null);
  const [nocFile, setNocFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const isCommercial = type === "commercial";
  const isVilla = type === "villa";
  const hasPlot = isVilla || type === "townhouse";
  const unitError =
    attempted && !unit.trim()
      ? "Give the unit a reference, e.g. Unit 1904."
      : undefined;
  const positive = (value: string) =>
    value.trim() && Number(value) > 0 ? Number(value) : null;
  const coordinate = (value: string) =>
    value.trim() && Number.isFinite(Number(value.trim()))
      ? Number(value.trim())
      : null;
  const pinLat = coordinate(lat);
  const pinLng = coordinate(lng);
  const hasPin = pinLat !== null && pinLng !== null;

  /** Accepts a pasted "lat, lng" pair in either box, as the quotation form does. */
  function setCoordinate(field: "lat" | "lng", raw: string) {
    const pair = raw.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/,
    );
    if (pair) {
      setLat(pair[1]);
      setLng(pair[2]);
      return;
    }
    if (field === "lat") setLat(raw.trim());
    else setLng(raw.trim());
  }

  async function save() {
    setAttempted(true);
    if (!unit.trim()) return;
    setSaving(true);
    try {
      const input = {
        client_id: clientId,
        unit_label: unit.trim(),
        building_name: building.trim(),
        community: community.trim(),
        developer_name: developer.trim(),
        property_type: type,
        bedrooms: isCommercial ? null : bedrooms,
        built_up_area_sqft: positive(builtUp),
        plot_area_sqft: hasPlot ? positive(plot) : null,
        floors: isVilla ? positive(floors) : null,
        external_areas_in_scope: hasPlot ? external : false,
        // A pin is both numbers or neither.
        location_lat: hasPin ? pinLat : null,
        location_lng: hasPin ? pinLng : null,
        noc_required: nocRequired,
        // The files already on record stay: the save replaces the whole record.
        title_deed_path: address?.title_deed_path ?? "",
        noc_path: address?.noc_path ?? "",
      };
      const saved = address
        ? await snaggingService.updateProperty(address.id, input)
        : await snaggingService.createProperty(input);

      /*
        The documents, once there is an address to put them on. A failed
        upload costs the file, not the address: it is reported and the
        address stays saved, where the file can be added again.
      */
      const failed: string[] = [];
      for (const [file, kind, label] of [
        [deedFile, "title_deed", "title deed"],
        [nocFile, "noc", "NOC"],
      ] as const) {
        if (!file) continue;
        try {
          const { file: prepared } = await compressImage(file);
          await snaggingService.uploadPropertyDocument(
            saved.id,
            prepared,
            kind,
          );
        } catch {
          failed.push(label);
        }
      }

      if (failed.length > 0) {
        toast.warning(
          `The address was saved, but the ${failed.join(" and ")} did not upload.`,
          {
            description: "Open the address and add it again.",
          },
        );
      } else if (address) {
        toast.success("Address updated");
      } else {
        toast.success("Address added", {
          description:
            "It will be filled in when this client is picked on a quotation or a job.",
        });
      }
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the address",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
        <FormBlock
          title={address ? "Edit address" : "New address"}
          description="The unit, and what it is. Only the reference is required."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Unit reference"
              htmlFor="address-unit"
              required
              error={unitError}
            >
              <Input
                id="address-unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="e.g. Unit 1904"
                aria-invalid={Boolean(unitError) || undefined}
                autoFocus
              />
            </FormField>
            <FormField label="Project / tower" htmlFor="address-building">
              <Input
                id="address-building"
                value={building}
                onChange={(event) => setBuilding(event.target.value)}
                placeholder="e.g. Riviera Tower 3"
              />
            </FormField>
            <FormField label="Community" htmlFor="address-community">
              <Input
                id="address-community"
                value={community}
                onChange={(event) => setCommunity(event.target.value)}
                placeholder="e.g. Meydan"
              />
            </FormField>
            <FormField label="Developer" htmlFor="address-developer">
              <Input
                id="address-developer"
                value={developer}
                onChange={(event) => setDeveloper(event.target.value)}
                placeholder="e.g. Emaar"
              />
            </FormField>
            <FormField label="Property type" htmlFor="address-type">
              <Select
                value={type}
                onValueChange={(value) =>
                  setType(value as SnaggingPropertyType)
                }
              >
                <SelectTrigger id="address-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROPERTY_TYPE_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </FormField>
            {!isCommercial ? (
              <FormField label="Bedrooms" htmlFor="address-bedrooms">
                <Select
                  value={String(bedrooms)}
                  onValueChange={(value) => setBedrooms(Number(value))}
                >
                  <SelectTrigger id="address-bedrooms" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Studio</SelectItem>
                    {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} bedroom{n > 1 ? "s" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            <FormField
              label="Built-up area (sq ft)"
              htmlFor="address-built-up"
              hint="Optional here. A quotation is priced on it."
            >
              <Input
                id="address-built-up"
                type="number"
                inputMode="decimal"
                value={builtUp}
                onChange={(event) => setBuiltUp(event.target.value)}
                placeholder="e.g. 1200"
              />
            </FormField>
            {hasPlot ? (
              <FormField label="Plot area (sq ft)" htmlFor="address-plot">
                <Input
                  id="address-plot"
                  type="number"
                  inputMode="decimal"
                  value={plot}
                  onChange={(event) => setPlot(event.target.value)}
                  placeholder="e.g. 3500"
                />
              </FormField>
            ) : null}
            {isVilla ? (
              <FormField label="Number of floors" htmlFor="address-floors">
                <Input
                  id="address-floors"
                  type="number"
                  inputMode="numeric"
                  value={floors}
                  onChange={(event) => setFloors(event.target.value)}
                  placeholder="e.g. 2"
                />
              </FormField>
            ) : null}
          </div>

          {hasPlot ? (
            <OptionRow
              checked={external}
              onChange={setExternal}
              title="External areas are in scope"
              description="Garden, pool and landscaping are inspected too."
            />
          ) : null}
        </FormBlock>

        <FormBlock
          title="Location"
          description="Optional. Search or click the map to drop a pin, or paste a coordinate. The inspector's phone opens directions from it."
        >
          <LocationPicker
            lat={hasPin ? pinLat : null}
            lng={hasPin ? pinLng : null}
            onPick={(nextLat, nextLng) => {
              setLat(String(nextLat));
              setLng(String(nextLng));
            }}
            onClear={() => {
              setLat("");
              setLng("");
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Latitude"
              htmlFor="address-lat"
              hint="You can paste a lat, lng pair here."
            >
              <Input
                id="address-lat"
                inputMode="decimal"
                value={lat}
                onChange={(event) => setCoordinate("lat", event.target.value)}
                placeholder="e.g. 25.0772"
              />
            </FormField>
            <FormField label="Longitude" htmlFor="address-lng">
              <Input
                id="address-lng"
                inputMode="decimal"
                value={lng}
                onChange={(event) => setCoordinate("lng", event.target.value)}
                placeholder="e.g. 55.1345"
              />
            </FormField>
          </div>
        </FormBlock>

        <FormBlock
          title="Documents"
          description="Optional paperwork, kept with the address so every job on this unit has it."
        >
          <OptionRow
            checked={nocRequired}
            onChange={setNocRequired}
            title="An NOC or authorization letter is required"
            description="The person requesting the inspection is not the owner."
          />
          <div className="divide-y overflow-hidden rounded-lg border">
            <DocumentRow
              label="Title deed"
              emptyHint="Not uploaded. Confirms the unit and its area."
              onFile={Boolean(address?.title_deed_path)}
              url={address?.title_deed_url ?? null}
              file={deedFile}
              onPick={setDeedFile}
            />
            {nocRequired || address?.noc_path ? (
              <DocumentRow
                label="NOC / authorization letter"
                emptyHint="Not uploaded. Access may be refused on the day without it."
                onFile={Boolean(address?.noc_path)}
                url={address?.noc_url ?? null}
                file={nocFile}
                onPick={setNocFile}
              />
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            PNG, JPG, WEBP or PDF, up to 15MB.
          </p>
        </FormBlock>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <SubmitButton type="submit" pending={saving} pendingLabel="Saving…">
          {address ? "Save address" : "Add address"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** What an upload accepts, and the limit the endpoint enforces. */
const DOCUMENT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const DOCUMENT_MAX_MB = 15;

/**
 * One document on the address: whether it is on file, a link to open it,
 * and a way to add or replace it. A file picked here waits for the save.
 */
function DocumentRow({
  label,
  emptyHint,
  onFile,
  url,
  file,
  onPick,
}: {
  label: string;
  emptyHint: string;
  onFile: boolean;
  url: string | null;
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(next: File | undefined) {
    if (!next) return;
    if (!DOCUMENT_ACCEPT.split(",").includes(next.type)) {
      toast.error(
        "That file type is not accepted. Use a PDF, JPG, PNG or WEBP.",
      );
      return;
    }
    if (next.size > DOCUMENT_MAX_MB * 1024 * 1024) {
      toast.error(
        `That file is over ${DOCUMENT_MAX_MB} MB. Choose a smaller one.`,
      );
      return;
    }
    onPick(next);
  }

  return (
    <DataRow
      className="py-3"
      icon={<FileText aria-hidden />}
      active={onFile || Boolean(file)}
      title={label}
      subtitle={
        file
          ? `${file.name} · uploads when you save`
          : onFile
            ? "On file"
            : emptyHint
      }
      trailing={
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={DOCUMENT_ACCEPT}
            hidden
            onChange={(event) => {
              accept(event.target.files?.[0]);
              // The same file can be picked again after it was removed.
              event.target.value = "";
            }}
          />
          {onFile && url && !file ? (
            <Button asChild size="sm" variant="outline">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Download className="size-3.5" />
                View
              </a>
            </Button>
          ) : null}
          {file ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => onPick(null)}
              aria-label={`Remove the chosen ${label.toLowerCase()}`}
              title="Remove"
            >
              <X className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={onFile || file ? "outline" : "default"}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {file ? "Change" : onFile ? "Replace" : "Upload"}
          </Button>
        </div>
      }
    />
  );
}

/** A titled group of fields, so the long form reads as three short ones. */
function FormBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A yes/no about the unit, as a whole-row tick box. */
function OptionRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
        checked ? "border-brand bg-brand-50" : "hover:bg-muted/40",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(Boolean(value))}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-muted-foreground text-xs font-medium"
      >
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
