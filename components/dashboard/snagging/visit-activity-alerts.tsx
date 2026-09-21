"use client";

import Link from "next/link";
import {
  CalendarClock,
  ClipboardCheck,
  FileText,
  MessageSquareWarning,
  PlayCircle,
  UserCog,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SnaggingJobVisit } from "@/types/types";

import { formatLocalDate, formatLocalDateTime } from "./shared";

type Tone = "action" | "info";

type VisitNotice = {
  visit: SnaggingJobVisit;
  /** Lower sorts first: what needs somebody now leads. */
  rank: number;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  body: string;
  cta: { label: string; href: string };
};

/**
 * What each live additional visit on this job is waiting for, at the top
 * of the job page.
 *
 * A visit's state was only readable on the Additional visits tab, so the
 * job page said nothing while one was being worked. It said nothing when
 * the inspector submitted one for review either, and the Approve and Send
 * back buttons sat on a page nobody was sent to. Each live visit now says
 * where it is and who has to act, with the one button that moves it on.
 */
export function VisitActivityAlerts({
  taskId,
  visits,
}: {
  taskId: string;
  visits: SnaggingJobVisit[];
}) {
  const notices = visits
    .map((visit) => describe(taskId, visit))
    .filter((notice): notice is VisitNotice => notice !== null)
    .sort((a, b) => a.rank - b.rank || a.visit.visit_number - b.visit.visit_number);

  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {notices.map((notice) => {
        const Icon = notice.icon;
        return (
          <Alert
            key={notice.visit.id}
            className={cn(
              "px-4 py-3",
              notice.tone === "action" &&
                "border-warning/40 bg-warning/5 *:[svg]:text-warning",
            )}
          >
            <Icon />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.body}</AlertDescription>
            {/*
              Outside the description on purpose: it underlines every link
              inside it and darkens them on hover, which turned this button
              into underlined dark text on a dark fill.
            */}
            <div className="col-start-2 mt-2">
              <Button
                asChild
                size="sm"
                variant={notice.tone === "action" ? "default" : "outline"}
              >
                <Link href={notice.cta.href}>{notice.cta.label}</Link>
              </Button>
            </div>
          </Alert>
        );
      })}
    </div>
  );
}

function describe(taskId: string, visit: SnaggingJobVisit): VisitNotice | null {
  const n = visit.visit_number;
  const page = `/snagging/${taskId}/visits/${visit.id}`;
  const quotationTab = `${page}?tab=quotation`;
  const name = visit.inspector?.full_name || visit.inspector?.email || null;
  const who = name ?? "The inspector";
  const found = visit.snag_count ?? 0;
  const foundLine = `${found} new ${found === 1 ? "snag" : "snags"}`;

  switch (visit.status) {
    case "submitted":
      return {
        visit,
        rank: 0,
        tone: "action",
        icon: ClipboardCheck,
        title: `Visit ${n} is waiting for your review`,
        body: `${who} submitted it${visit.submitted_at ? ` on ${formatLocalDateTime(visit.submitted_at)}` : ""} with ${foundLine}. Open it to check the snags and checklist, then approve it to reissue the client's report with them, or send it back to the inspector with a note.`,
        cta: { label: `Review visit ${n}`, href: page },
      };

    case "in_progress":
      if (visit.review_note) {
        return {
          visit,
          rank: 2,
          tone: "info",
          icon: MessageSquareWarning,
          title: `Visit ${n} was sent back to ${name ?? "the inspector"}`,
          body: `Your note: "${visit.review_note}". It is open on their phone again and comes back here for review when they resubmit.`,
          cta: { label: `Open visit ${n}`, href: page },
        };
      }
      return {
        visit,
        rank: 3,
        tone: "info",
        icon: PlayCircle,
        title: `Visit ${n} is in progress`,
        body: `${who} started on site${visit.started_at ? ` on ${formatLocalDateTime(visit.started_at)}` : ""}. ${found > 0 ? `${foundLine} so far, marked "Visit ${n}" in the list below. ` : ""}It comes here for review once they submit it from the phone.`,
        cta: { label: `Open visit ${n}`, href: page },
      };

    case "scheduled": {
      const when = visit.appointment_at
        ? formatLocalDateTime(visit.appointment_at)
        : visit.scheduled_date
          ? formatLocalDate(visit.scheduled_date)
          : null;
      if (!visit.inspector_id) {
        return {
          visit,
          rank: 1,
          tone: "action",
          icon: UserCog,
          title: `Visit ${n} is booked but nobody is assigned`,
          body: `It is booked${when ? ` for ${when}` : ""}, but no inspector will see it on their phone until one is assigned.`,
          cta: { label: "Assign an inspector", href: page },
        };
      }
      return {
        visit,
        rank: 4,
        tone: "info",
        icon: CalendarClock,
        title: `Visit ${n} is booked${when ? ` for ${when}` : ""}`,
        body: `${who} has it in their Jobs list on the phone. It moves to in progress when they start it on site.`,
        cta: { label: `Open visit ${n}`, href: page },
      };
    }

    case "requested": {
      if (visit.charge_method === "payment_link") {
        return {
          visit,
          rank: 1,
          tone: "action",
          icon: CalendarClock,
          title: `Visit ${n} needs an inspector`,
          body: "It is charged by payment link, so it needs no quotation. Assign an inspector and a date to book it.",
          cta: { label: "Assign an inspector", href: page },
        };
      }
      const quote = visit.quotation;
      if (!quote || quote.status === "rejected") {
        return {
          visit,
          rank: 1,
          tone: "action",
          icon: FileText,
          title: quote ? `The client rejected visit ${n}'s quotation` : `Visit ${n} needs a quotation`,
          body: "The client approves a quotation before the visit can be booked.",
          cta: { label: quote ? "Raise a new quotation" : "Raise quotation", href: quotationTab },
        };
      }
      if (quote.status === "draft") {
        return {
          visit,
          rank: 1,
          tone: "action",
          icon: FileText,
          title: `Visit ${n}'s quotation has not been sent`,
          body: `${quote.quote_number ?? "The quotation"} is still a draft. Send it to the client; the visit can be booked once they approve it.`,
          cta: { label: "Send quotation", href: quotationTab },
        };
      }
      if (quote.status === "sent") {
        return {
          visit,
          rank: 5,
          tone: "info",
          icon: FileText,
          title: `Waiting for the client to approve visit ${n}`,
          body: `${quote.quote_number ?? "The quotation"} has been sent. The visit can be booked as soon as they approve it.`,
          cta: { label: "View quotation", href: quotationTab },
        };
      }
      return {
        visit,
        rank: 1,
        tone: "action",
        icon: CalendarClock,
        title: `The client approved visit ${n}'s quotation`,
        body: "Assign an inspector and a date to book it. It appears in their Jobs list on the phone straight away.",
        cta: { label: "Assign an inspector", href: page },
      };
    }

    default:
      // Completed and cancelled visits are history, on the Additional
      // visits tab; they ask nothing of anybody.
      return null;
  }
}
