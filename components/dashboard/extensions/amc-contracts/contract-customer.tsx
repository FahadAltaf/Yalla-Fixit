"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Fact } from "@/components/dashboard/extensions/amc/steps/review-step";
import { UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import { formatPhone, phoneHref } from "@/lib/phone/format-phone";
import { amcContractsService, type ContractDetail, type LiveLinks } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Who the customer and property are, as signed (the snapshot, which never
 * changes). The names open today's client and property records; where one
 * of those now says something else, it is noted under the value.
 */
export function ContractCustomer({
  contract,
  facts,
}: {
  contract: ContractDetail["contract"];
  /** More facts at the end of the grid, e.g. where the contract came from. */
  facts?: React.ReactNode;
}) {
  const [links, setLinks] = useState<LiveLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    amcContractsService.links(contract.id).then(
      ({ links: next }) => !stale && setLinks(next),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not load the links."),
    );
    return () => {
      stale = true;
    };
  }, [contract.id, attempt]);

  const signed = contract.customer as Record<string, string | undefined>;
  const signedProperty = contract.property as Record<string, string | undefined>;
  const live = links?.migrated ? links : null;
  const signedType = unitType(signedProperty.unitType);
  const signedAddress = signedProperty.propertyAddress || null;

  return (
    <SectionCard
      title="Client and property"
      description="What the contract is written for, as signed. Where today's client or property record differs, it is noted under the value."
      icon={<UserRound />}
      bodyClassName="px-5 pb-5"
    >
      {error ? (
        <div className="mb-4">
          <ErrorState
            title="Could not load the linked records"
            message={error}
            onRetry={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          />
        </div>
      ) : null}
      <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact
          label="Customer"
          note={live ? (live.customer ? differs(contract.customerName, live.customer.name) : "No client record linked") : null}
        >
          {live?.customer ? (
            <Link href={`/extensions/amc-contracts/customers/${live.customer.id}`} className={LINK}>
              {contract.customerName || live.customer.name}
            </Link>
          ) : (
            contract.customerName
          )}
        </Fact>
        <Fact label="Customer ID" note={differs(contract.customerRef, live?.customer?.customerRef)}>
          {contract.customerRef}
        </Fact>
        <Fact label="Phone" note={differs(formatPhone(signed.customerPhone), formatPhone(live?.customer?.phone))}>
          {phoneLink(signed.customerPhone)}
        </Fact>
        <Fact label="Email" note={differs(signed.customerEmail, live?.customer?.email)}>
          {emailLink(signed.customerEmail)}
        </Fact>
        <Fact
          label="Property"
          note={live ? (live.property ? differs(signedProperty.propertyDetail, live.property.label) : "No property record linked") : null}
        >
          {live?.property ? (
            <Link href={`/extensions/amc-contracts/properties/${live.property.id}`} className={LINK}>
              {signedProperty.propertyDetail || live.property.label}
            </Link>
          ) : (
            signedProperty.propertyDetail || contract.propertyLabel
          )}
        </Fact>
        <Fact label="Unit type" note={differs(signedType, unitType(live?.property?.unitType))}>
          {signedType}
        </Fact>
        <Fact label="Address" note={differs(signedAddress, live?.property?.address)}>
          {signedAddress}
        </Fact>
        <Fact label="Account managers">
          {contract.accountManagers
            .map((m) => m.name)
            .filter(Boolean)
            .join(", ") || "None named"}
        </Fact>
        {facts}
      </dl>
      {!links && !error ? <p className="text-muted-foreground mt-3 text-xs">Checking today&apos;s client and property records…</p> : null}
      {links && !links.migrated ? <p className="text-muted-foreground mt-3 text-xs">Needs migration 20261006130000 to link client records.</p> : null}

    </SectionCard>
  );
}

const LINK = "hover:text-brand underline underline-offset-2";

function phoneLink(phone: string | null | undefined) {
  return phone ? (
    <a href={phoneHref(phone)} className={LINK}>
      {formatPhone(phone)}
    </a>
  ) : null;
}

function emailLink(email: string | null | undefined) {
  return email ? (
    <a href={`mailto:${email}`} className={LINK}>
      {email}
    </a>
  ) : null;
}

/** Today's record value, when it is set and no longer matches what was signed. */
function differs(signedValue: string | null | undefined, today: string | null | undefined) {
  const before = (signedValue ?? "").trim();
  const now = (today ?? "").trim();
  return now && before.toLowerCase() !== now.toLowerCase() ? `Record now: ${now}` : null;
}

function unitType(value: string | null | undefined) {
  return value ? (UNIT_TYPE_LABELS[value as keyof typeof UNIT_TYPE_LABELS] ?? value) : null;
}
