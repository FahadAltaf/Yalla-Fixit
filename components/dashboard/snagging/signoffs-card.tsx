"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed storage URLs. */
import { Lock, PenLine } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import type { SnaggingSignoff } from "@/types/types";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Every inspector's signature on the job, for the office (2026-09-28).
 *
 * A job walked by several inspectors is signed by each of them. The
 * client's report shows one signature -- the one the job carries -- and
 * the rest are kept here, on the staff-only job page, so the office can
 * always see who signed which pass and when.
 */
export function SignoffsCard({
  signoffs,
  clientSigner,
}: {
  signoffs: SnaggingSignoff[] | undefined;
  /** The name on the one signature the client's report shows. */
  clientSigner?: string | null;
}) {
  if (!signoffs?.length) return null;

  return (
    <SectionCard
      icon={<PenLine />}
      title="Inspector sign-offs"
      description={
        clientSigner
          ? `Every inspector's signature, kept internally. The client's report shows one: ${clientSigner}'s.`
          : "Every inspector's signature, kept internally. The client's report shows one."
      }
      action={
        <Badge variant="outline" className="gap-1">
          <Lock className="size-3" />
          Internal
        </Badge>
      }
      bodyClassName="border-t"
    >
      <ul className="divide-y">
        {signoffs.map((signoff) => {
          const onReport =
            !signoff.visit_id &&
            Boolean(clientSigner) &&
            (signoff.signer_name === clientSigner || signoff.inspector_name === clientSigner);
          return (
            <li key={signoff.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{signoff.inspector_name}</span>
                  {onReport ? (
                    <Badge variant="secondary" className="text-xs">
                      On the client&apos;s report
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {signoff.visit_id ? "Return visit" : "Inspection"} · signed {WHEN.format(new Date(signoff.signed_at))}
                </p>
              </div>
              <div className="bg-background flex h-14 w-40 items-center justify-center rounded-md border">
                {signoff.signature_url ? (
                  <img
                    src={signoff.signature_url}
                    alt={`${signoff.inspector_name}'s signature`}
                    className="max-h-12 max-w-36 object-contain"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">No drawing</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
