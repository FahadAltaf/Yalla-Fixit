"use client";

import type { ReactNode } from "react";
import { Building2, FileText, ShieldCheck, StickyNote } from "lucide-react";

import { DataRow, SectionCard, StatCard, StatCardGrid, SubHeading } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/utils";
import type { SnaggingQuotation } from "@/modules/snagging";

import { GoogleLocationMap, hasGoogleMapsKey } from "./google-location-map";
import { LocationMap } from "./location-map";
import { PROPERTY_TYPE_LABELS } from "./shared";

/**
 * Everything the quotation was raised with, as the form took it: who it is
 * for, the unit, how it was priced, its paperwork and the office note, with
 * who raised and changed it (SNG-022, SNG-037).
 *
 * Laid out like the job page: the figures as the Snags tab draws them, then
 * the Setup tab's "Property & client" card with the map beside the lists,
 * its Office notes card and its document card, so the two pages read the
 * same way.
 *
 * Read from the quotation the page already loaded (its live client and
 * property records come with it), so this tab costs no request of its own.
 */
export function QuotationDetailsTab({ quote }: { quote: SnaggingQuotation }) {
  const property = (quote.property ?? {}) as Record<string, unknown>;
  const snapshot = (quote.property_snapshot ?? {}) as Record<string, unknown>;
  const client = quote.client ?? null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const sqft = (value: unknown) => (num(value) ? `${(num(value) as number).toLocaleString("en-US")} sq ft` : null);
  const type = text(property.property_type) ?? text(snapshot.property_type);
  const bedrooms = num(property.bedrooms);
  const lat = num(property.location_lat);
  const lng = num(property.location_lng);
  const unit = text(property.unit_label) ?? text(snapshot.unit_label);
  const building = text(property.building_name) ?? text(snapshot.building_name);
  const email = client?.email ?? text(snapshot.client_email);
  const phone = client?.phone ?? text(snapshot.client_phone);
  const kind =
    quote.quote_kind === "desnag"
      ? "De-snagging"
      : quote.quote_kind === "visit"
        ? "Additional visit"
        : "Snagging inspection";
  const nocRequired = property.noc_required === true;
  const nocOnFile = Boolean(text(property.noc_path));
  const deedOnFile = Boolean(text(property.title_deed_path));
  const rateOutside = Boolean(quote.rate_outside_band);

  return (
    <div className="flex flex-col gap-4">
      {/* The four answers somebody opens a quotation for, as the Snags tab's figures. */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Total"
          value={<Money value={quote.total} />}
          headline={`Including ${quote.tax_rate}% VAT`}
        />
        <StatCard
          label="Status"
          value={STATUS_VALUE[quote.status] ?? quote.status}
          headline={`Quotation ${quote.quote_number} · ${kind}`}
          tone={
            quote.status === "approved"
              ? "good"
              : quote.status === "rejected"
                ? "bad"
                : quote.status === "sent"
                  ? "progress"
                  : "neutral"
          }
        />
        <StatCard
          label="Rate per sq ft"
          value={quote.rate_per_sqft ?? "Fixed"}
          headline={
            quote.rate_per_sqft == null
              ? "A fixed charge, not priced by area"
              : rateOutside
                ? "Outside the card band"
                : quote.rate_suggested != null
                  ? `Suggested ${quote.rate_suggested}`
                  : "Within the card band"
          }
          tone={quote.rate_per_sqft == null ? "neutral" : rateOutside ? "bad" : "good"}
        />
        <StatCard
          label="Furnishing"
          value={quote.furnished == null ? "—" : quote.furnished ? "Furnished" : "Unfurnished"}
          headline={quote.out_of_hours ? "Booked out of hours" : "Booked in working hours"}
          tone={quote.out_of_hours ? "progress" : "neutral"}
        />
      </StatCardGrid>

      <SectionCard
        title="Property & client"
        icon={<Building2 />}
        description="The unit this quotation is for, and who to contact about it."
        bodyClassName="px-5 pb-5"
      >
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="space-y-3">
              <SubHeading>Property</SubHeading>
              <DetailList
                rows={[
                  { label: "Unit", value: unit },
                  { label: "Building", value: building },
                  { label: "Community", value: text(property.community) ?? text(snapshot.community) },
                  { label: "Type", value: type ? (PROPERTY_TYPE_LABELS[type] ?? type) : null },
                  { label: "Bedrooms", value: bedrooms == null ? null : bedrooms === 0 ? "Studio" : String(bedrooms) },
                  { label: "Built-up area", value: sqft(property.built_up_area_sqft) },
                  { label: "Plot area", value: sqft(property.plot_area_sqft) },
                  { label: "Floors", value: num(property.floors) ? String(property.floors) : null },
                  { label: "Developer", value: text(property.developer_name) ?? text(snapshot.developer_name) },
                  {
                    label: "External areas",
                    value: property.external_areas_in_scope ? "In scope" : "Not in scope",
                  },
                ]}
              />
            </div>

            <div className="space-y-3">
              <SubHeading>Client</SubHeading>
              <DetailList
                rows={[
                  { label: "Name", value: client?.name ?? text(snapshot.client_name) },
                  { label: "Email", value: email, href: email ? `mailto:${email}` : undefined },
                  { label: "Phone", value: phone, href: phone ? `tel:${phone}` : undefined },
                  { label: "Company", value: client?.company ?? null },
                  { label: "Maher ID", value: client?.maher_id ?? null },
                ]}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col space-y-3">
            <SubHeading>Location</SubHeading>
            {lat != null && lng != null ? (
              hasGoogleMapsKey() ? (
                <GoogleLocationMap
                  className="flex-1"
                  lat={lat}
                  lng={lng}
                  label={[unit, building].filter(Boolean).join(", ") || null}
                />
              ) : (
                <LocationMap
                  className="flex-1"
                  lat={lat}
                  lng={lng}
                  label={[unit, building].filter(Boolean).join(", ") || null}
                />
              )
            ) : (
              <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
                No location pinned on the property record.
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Office notes (SNG-022): typed on the form, copied to the job for the inspector. */}
      <SectionCard
        title="Office notes"
        icon={<StickyNote />}
        description="Anything the inspector should know on site. Copied to the job and shown in the inspector app."
        bodyClassName="px-5 pb-5"
      >
        <p className="text-sm whitespace-pre-wrap">
          {quote.notes?.trim() || <span className="text-muted-foreground">No office notes.</span>}
        </p>
      </SectionCard>

      {/* The unit's paperwork (FR-1.09), as the job's NOC card shows it. */}
      <SectionCard
        title="Documents"
        icon={<ShieldCheck />}
        description="The title deed and the no objection certificate, held on the property record."
        action={
          <Badge
            variant="secondary"
            className={cn(
              "border-0 font-medium",
              nocOnFile ? "bg-success/10 text-success" : nocRequired ? "bg-warning/10 text-warning" : "bg-mist text-ink-soft",
            )}
          >
            {nocOnFile ? "NOC on file" : nocRequired ? "NOC required, missing" : "NOC not required"}
          </Badge>
        }
        bodyClassName="px-5 pb-5"
      >
        <div className="divide-y overflow-hidden rounded-lg border">
          <DataRow
            className="py-3"
            icon={<FileText aria-hidden />}
            active={deedOnFile}
            title="Title deed"
            subtitle={deedOnFile ? "On file on the property record" : "Not uploaded."}
          />
          <DataRow
            className="py-3"
            icon={<FileText aria-hidden />}
            active={nocOnFile}
            title="No objection certificate"
            subtitle={
              nocOnFile
                ? "On file and available to the inspector"
                : nocRequired
                  ? "Not uploaded. Access may be refused on the day."
                  : "Not uploaded. This unit does not require one."
            }
          />
        </div>
      </SectionCard>
    </div>
  );
}

/** The status as a figure: short enough to sit in a stat card. */
const STATUS_VALUE: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * Label-and-value rows, as the job's Setup tab draws them. A missing value
 * shows a dash rather than collapsing the row, so the record keeps its shape.
 */
function DetailList({ rows }: { rows: Array<{ label: string; value?: ReactNode; href?: string }> }) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium">
            {row.value ? (
              row.href ? (
                <a href={row.href} className="hover:text-brand underline underline-offset-2">
                  {row.value}
                </a>
              ) : (
                row.value
              )
            ) : (
              <span className="text-muted-foreground font-normal">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
