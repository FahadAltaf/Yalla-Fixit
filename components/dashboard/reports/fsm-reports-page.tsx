import Link from "next/link";
import { ExternalLink, LinkIcon, Settings2 } from "lucide-react";

import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type FsmReportLink = {
  key: string;
  title: string;
  description: string;
  kind: "FSM standard" | "FSM custom";
  url: string | null;
};

/**
 * BRD 5.2 B5: the reports kept in Zoho FSM, opened from the portal. Each
 * opens in FSM in a new tab; one without an address says so, and who sets
 * it.
 */
export function FsmReportsPage({ links, canConfigure }: { links: FsmReportLink[]; canConfigure: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Zoho FSM reports"
        description="Reports kept in Zoho FSM. They open there, with what your FSM account can see."
        actions={
          canConfigure ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/reporting">
                <Settings2 className="size-4" />
                Set the links
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => (
          <Card key={link.key} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{link.title}</p>
              <Badge variant="secondary" className="shrink-0">
                {link.kind}
              </Badge>
            </div>
            <p className="text-muted-foreground flex-1 text-sm">{link.description}</p>
            {link.url ? (
              <Button asChild variant="outline" size="sm" className="w-fit">
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Open in Zoho FSM
                </a>
              </Button>
            ) : (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <LinkIcon className="size-3.5" />
                {link.kind === "FSM custom" ? "To be built in Zoho FSM; not linked yet." : "Not linked yet."} An administrator adds the address in Settings →
                Reporting → FSM report links.
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
