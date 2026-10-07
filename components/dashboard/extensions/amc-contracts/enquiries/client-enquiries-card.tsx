"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";

import { DataRow, SectionCard } from "@/components/dashboard/shared/kaizen";
import { enquiriesService } from "@/modules/amc-contracts/enquiries-service";

import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";
import { EnquiryFlags, StageBadge } from "./enquiry-ui";

/**
 * A client's enquiries on their page (BRD 5.9: one record from prospect to
 * client). Shown only to people who may see enquiries, and only once the
 * enquiry tables exist.
 */
export function ClientEnquiriesCard({ customerId }: { customerId: string }) {
  const { data, error } = useAmcData(
    () => Promise.all([enquiriesService.list({ customer: customerId, pageSize: 10 }), enquiriesService.meta()]),
    `client-enquiries|${customerId}`,
  );
  if (error || !data) return null;
  const [list, meta] = data;
  if (!list.migrated) return null;
  return (
    <SectionCard title="Enquiries" icon={<Inbox />} bodyClassName="px-5 pb-5">
      {list.enquiries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No enquiries for this client.</p>
      ) : (
        list.enquiries.map((e) => (
          <DataRow
            key={e.id}
            icon={<Inbox />}
            title={
              <Link href={`/extensions/amc-contracts/enquiries/${e.id}`} className="hover:underline">
                {e.enquiryNumber} · {e.need}
              </Link>
            }
            subtitle={[formatContractDate(e.enquiredAt), e.source, e.owner?.name].filter(Boolean).join(" · ")}
            trailing={
              <div className="flex flex-col items-end gap-1">
                <StageBadge stage={e.stage} stages={meta.stages} />
                <EnquiryFlags enquiry={e} compact />
              </div>
            }
          />
        ))
      )}
      {list.total > list.enquiries.length ? <p className="text-muted-foreground mt-2 text-xs">Showing the latest {list.enquiries.length} of {list.total}.</p> : null}
    </SectionCard>
  );
}
