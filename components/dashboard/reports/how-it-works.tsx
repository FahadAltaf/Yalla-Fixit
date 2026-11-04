"use client";

import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * "How this report works" (29 Oct): an icon beside each report's controls
 * that opens the report's calculation in plain words: where the data comes
 * from, how each figure is worked out, and what is left out, in plain
 * section it follows. The words live here, next to each other, so the
 * reports read alike; the figures they quote are the live settings.
 *
 * Shown in development only (3 Nov): the live site does not show it.
 */

export type HowItWorksSection = { heading: string; lines: string[] };
export type HowItWorksContent = { title: string; summary: string; sections: HowItWorksSection[] };

export function HowItWorks({ content }: { content: HowItWorksContent }) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="size-9" aria-label={`How ${content.title} works`} title="How this report works">
          <Info className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How {content.title} works</DialogTitle>
          <DialogDescription>{content.summary}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          {content.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-1.5">
              <h3 className="font-medium">{section.heading}</h3>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                {section.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SHARED_FILTERS =
  "Date range, technician, team and client filters, export to a spreadsheet, drill-through and saved filters per person, as on every report. The figures at the top follow the dates only: the other filters narrow the tables below.";

export function quotationsHowItWorks(s?: { limits?: { notSent: number; sent: number; approved: number }; expiryWarningDays?: number }): HowItWorksContent {
  const l = s?.limits;
  return {
    title: "the quotation summary",
    summary: "The quotation pipeline from Zoho FSM: what the team is generating and where it gets stuck.",
    sections: [
      {
        heading: "Where the data comes from",
        lines: ["Quotations read live from Zoho FSM (10-minute copy; Refresh reads again).", "Value is the quotation's total including VAT."],
      },
      {
        heading: "Statuses",
        lines: [
          "Seven statuses: Not sent (FSM's New), Sent, Approved, Converted to work order, Rejected, Revised, Expired. An FSM status not in this list keeps its own name, so nothing is hidden.",
          "Per status: count, total value and average days in the status. Click a status to list it. A status card turns red when any of its quotations is past its limit.",
        ],
      },
      {
        heading: "Ageing and expiry",
        lines: [
          `Days in the current status. Past its limit it is flagged and the ageing recipients are told: Not sent ${l?.notSent ?? 7} days, Sent ${l?.sent ?? 10}, Approved ${l?.approved ?? 5}.`,
          `Waiting on the client with its validity ending within ${s?.expiryWarningDays ?? 5} days: highlighted, and its owner told.`,
          "Where FSM does not say when the status began, the nearest FSM date stands in and the row says so (estimated).",
        ],
      },
      {
        heading: "Filters",
        lines: [
          "Created date, owner, client, value band (including VAT), flag and status. The Filters button shows how many are set. Your selections are kept for next time.",
          "The status cards and the line under them follow the dates only: the other filters narrow the list, not the figures above it.",
        ],
      },
    ],
  };
}

export function utilizationHowItWorks(s?: { standardDailyHours?: number; dataCentreDailyHours?: number }): HowItWorksContent {
  const day = s?.standardDailyHours ?? 8;
  return {
    title: "technician utilization",
    summary: "Two measures side by side: how busy each technician was, and how much of that work could be billed.",
    sections: [
      {
        heading: "Expected hours",
        lines: [
          `The week is the measure. A week expects the smaller of the technician's weekly hour limit and their hours a day × the days they work a week (7 less their off days). Hours a day: ${day} h; ${s?.dataCentreDailyHours ?? 12} h for a technician whose Service Type is Data Center; or their own. Hours a day, weekly limit and off days a week are set in Workforce → People → ⋮ → Working hours; not set: the day above, no weekly limit, one off day.`,
          "Less a working day's share for each public holiday (Settings → Reporting → Holidays), the leave taken (any type; Workforce → People → ⋮ → Add leave, and FSM Time Off), and every day from a leaving date.",
          "Off days are not fixed weekdays. A week cut by the dates expects its days less the off days, or the days worked if more; so a single day expects a day's hours only if it was worked.",
          "A technician with no off days entered: one a week, and the row is flagged.",
          "Team, hours and limits are those in force on each day, so a later change does not rewrite past periods.",
        ],
      },
      {
        heading: "Job hours",
        lines: [
          "From Completed appointments, and Cannot Complete ones with both actual times, in Zoho FSM.",
          "Each technician's own time: their FSM time sheet; else the appointment's actual times trimmed to their own check-in and check-out (FSM Attendance); else the appointment's actual times, counted as unverified.",
          "Overlapping jobs count once. Every hour counts, on off days and public holidays too, so utilization can pass 100 %. Each week's hours beyond what it expected are shown beside as Above expected.",
        ],
      },
      {
        heading: "The two measures",
        lines: [
          "Time utilization = job hours ÷ expected hours.",
          "Commercial utilization = chargeable job hours ÷ expected hours. Chargeable: the quotation's total is above zero or, with no quotation, the work order has a value. A total of zero (inspection, internal work) counts for time only.",
          "AMC and in-contract work is never chargeable, whatever its value: FSM marks it with Work Type AMC PPM or an AMC contract reference on the work order. It counts for time utilization only.",
        ],
      },
      {
        heading: "Beside utilization",
        lines: [
          "Travel: FSM trips, as hours and as a share of the day (travel ÷ expected hours). Never inside utilization.",
          "Data completeness: completed appointments with both actual times ÷ all completed; one without them is left out, not counted as zero.",
          "Actual against scheduled: the gap between actual and booked time, which points to estimating problems.",
        ],
      },
      { heading: "Views and filters", lines: ["Daily, weekly or monthly trend; by technician, by team, and the appointments behind any figure.", SHARED_FILTERS, "A client filter counts only that client's work; expected hours stay the technicians' whole weeks."] },
    ],
  };
}

export function capacityHowItWorks(s?: { horizonDays?: number; spareBelowPercent?: number }): HowItWorksContent {
  return {
    title: "capacity",
    summary: "Forward capacity: hours booked against hours available, by day and team, so over-booked and spare days show before they arrive.",
    sections: [
      {
        heading: "Booked hours",
        lines: [
          "The scheduled time of every FSM appointment that is not cancelled, for each technician on it (crews as planned in FSM).",
          "Split by calendar day (Dubai): a job past midnight counts on both days. Two bookings at the same time count once for that person.",
        ],
      },
      {
        heading: "Available hours",
        lines: [
          "Each working day in full: the technician's own hours a day, set in Workforce → People → ⋮ → Working hours; not set, 8 h (12 h for a Data Center technician). Less any leave that day.",
          "Fixed rest days, public holidays (Settings → Reporting → Holidays) and days after leaving count nothing.",
          "Capacity uses the fixed rest days, also set in Working hours: on a calendar a day is worked or not. Until they are set, every day shows as a working day. (Utilization counts off days a week instead.)",
        ],
      },
      {
        heading: "Highlighted days",
        lines: [
          "Over-booked: booked hours above available hours. A booking on a rest day, holiday or leave is over-booking too.",
          `Spare: less than ${s?.spareBelowPercent ?? 50}% of available hours booked.`,
          "Unassigned: scheduled hours on appointments with nobody on them, shown apart and never in a team.",
          "Click a cell for the bookings behind it.",
        ],
      },
      {
        heading: "Dates and filters",
        lines: [
          `Opens on the capacity horizon from Reporting Settings (${s?.horizonDays ?? 14} days from today), the same days the over-booking alert watches.`,
          "Team and client narrow the board; a client counts only its own bookings against everyone's availability.",
        ],
      },
    ],
  };
}

export function exceptionsHowItWorks(s?: { afterDays?: number }): HowItWorksContent {
  return {
    title: "the exception reports",
    summary: "Two lists that protect the invoicing queue and utilization from gaps in the data.",
    sections: [
      {
        heading: "Completed without the invoice flag",
        lines: [
          "Work orders completed in FSM, on a quotation with a value, that nobody has marked ready to invoice and that are not already in the queue.",
          `Past ${s?.afterDays ?? 3} days (Reporting Settings) a row is overdue and its coordinator is told.`,
        ],
      },
      {
        heading: "Appointments completed without actual times",
        lines: [
          "Completed appointments missing an actual start or end in FSM. They drop out of job hours, so utilization would be wrong.",
          "Data completeness % per team and technician: the same figure that sits beside utilization. A team counts an appointment once; a technician counts every appointment they were on. Hover a header or value for its sum.",
        ],
      },
      { heading: "Filters", lines: [SHARED_FILTERS] },
    ],
  };
}

export function revenueHowItWorks(): HowItWorksContent {
  return {
    title: "revenue",
    summary: "What the completed work was worth, by client, technician and month, with the AMC mix, what is invoiced and the customers' ratings.",
    sections: [
      {
        heading: "What counts as revenue",
        lines: [
          "Work orders completed in Zoho FSM in the dates, at their value before VAT, on the day FSM completed them (4 Nov).",
          "A work order with no value of its own counts its quotation's; with neither it is listed at 0. Work still in progress in FSM is not counted until it is marked Completed there.",
          "AMC: Work Type AMC PPM, or an AMC contract reference on the work order. Everything else is one-time work.",
        ],
      },
      {
        heading: "Shared jobs (D-17)",
        lines: [
          "A work order's revenue is split between its technicians by their hours on it: their own FSM time sheet, else the appointment's actual times. With no hours recorded for anyone, the crew share it equally.",
          "Technician shares add up to the revenue; work orders with nobody from the technician list on them (none in FSM, or only test and office accounts) sit under Not on the technician list.",
        ],
      },
      {
        heading: "Invoiced and ratings",
        lines: [
          "Invoiced: MAHER invoices recorded in Ready to invoice against those work orders, before VAT. Invoices raised outside the portal are not known.",
          "Ratings: the customer's stars on FSM service reports made in the dates, 1 to 5; FSM's 0 means no rating and is left out. A rating counts for every technician on its appointment.",
        ],
      },
      { heading: "Filters", lines: [SHARED_FILTERS] },
    ],
  };
}

export function attendanceHowItWorks(s?: { lateToleranceMinutes?: number }): HowItWorksContent {
  return {
    title: "daily attendance",
    summary: "Per technician per day: shift, check-in and check-out, hours present, the flags and leave, with the monthly summary for HR.",
    sections: [
      {
        heading: "Where the data comes from",
        lines: [
          "Check-in and check-out: FSM Attendance, one record per technician per day (first check-in, last check-out), kept together, so a night's morning check-out stays with its evening.",
          "Shift, rest days, leave and leaving date: Workforce → People (Edit attributes, Working hours, Add leave) and FSM Time Off; holidays: Settings → Reporting → Holidays.",
          "Work in FSM: the day's appointments with actual times, marked when they were started by someone else on the crew.",
          "Times are shown in your own timezone, named in the column heading; a time on another day shows its date. The shift day is Dubai's, as FSM's Date field: a session that starts on the 28th belongs to the 28th even when it ends the next morning, and its hours present show its full length.",
        ],
      },
      {
        heading: "The flags",
        lines: [
          `Late: checked in more than ${s?.lateToleranceMinutes ?? 15} minutes after the start of the technician's shift (their shift: Workforce → People → ⋮ → Edit attributes).`,
          "Left early: checked out before the shift end.",
          "Outside shift: checked in, but at no time within the shift (widened to the day's scheduled jobs, as on the Scheduling board). Not late or early: the shift set does not fit.",
          "Absent: a working day, not on leave, with no check-in and no work of their own in FSM, once the day's hours are over.",
          "Worked, no check-in: no check-in, but FSM shows them doing the work (the appointment's lead or their own time sheet).",
          "No check-out: a past day's record never closed.",
        ],
      },
      {
        heading: "Read with care",
        lines: ["A technician with no rest day set has every day as a working day, so an absence may be their day off; the page says how many."],
      },
      { heading: "Filters", lines: [SHARED_FILTERS, "A client keeps the technicians booked on its appointments in the dates."] },
    ],
  };
}

export function complianceHowItWorks(s?: { thresholdPercent?: number | null; penaltyPerMissAed?: number; monthlyCapAed?: number; cutoffDay?: number }): HowItWorksContent {
  return {
    title: "app compliance",
    summary: "Whether technicians check in and out in the FSM app, month by month, and the penalty the policy works out. The portal calculates; HR decides and applies.",
    sections: [
      {
        heading: "Required events",
        lines: [
          "On each working day: a shift check-in and check-out, and a check-in and check-out for every appointment they are on. A shift with three appointments needs eight.",
          "Not required: off-shift days, rest days, public holidays, days wholly on leave, days from the leaving date, and appointments cancelled or reassigned before they started.",
        ],
      },
      {
        heading: "Performed",
        lines: [
          "Shift: the FSM Attendance check-in and check-out of that shift day; an overnight check-out counts for its own evening.",
          "Appointment: the technician's own FSM time sheet on it, else the appointment's actual start and end.",
          "A late check-in still counts as performed.",
        ],
      },
      {
        heading: "Compliance and penalty",
        lines: [
          "Compliance % = performed ÷ required, waived events left out of both.",
          s?.thresholdPercent === null || s?.thresholdPercent === undefined
            ? "Threshold cleared in Reporting Settings: no penalty is worked out."
            : `Below ${s.thresholdPercent}%: every miss costs AED ${s.penaltyPerMissAed ?? 50}, capped at AED ${s.monthlyCapAed ?? 500} a month. At or above it, nothing.`,
          "Waivers: a supervisor or coordinator removes a miss with a reason; a confirmed outage can be waived for everyone at once.",
        ],
      },
      {
        heading: "Disputes",
        lines: [
          `A technician disputes a missed check-in, with the reason, until day ${s?.cutoffDay ?? 25} of the next month, that day included; a dispute the day after is refused. Most use FSM, not the portal, so a supervisor or coordinator can raise it for them.`,
          "The dispute reviewers named in Reporting Settings decide it: accepted, the miss is waived with a reason; rejected, the reason is recorded. They are told when one is raised.",
          "The month can be finalised only after the cut-off and once every dispute is decided; then its figures are frozen and the final report goes to HR by email.",
        ],
      },
      {
        heading: "Messages",
        lines: [
          "Missed check-in: the technician is told the morning after. Below the threshold: the technician, their team leader and the named supervisors are told, once a month. Both count only days before today: a late check-in still counts.",
          "At month close, each technician gets their statement, in the portal and by email: the figures, each miss, and how to dispute it by the cut-off.",
          "In-app messages reach a technician only with a portal account linked to them (same email as in FSM); the statement email goes to the address FSM holds.",
        ],
      },
      { heading: "Filters", lines: ["Month, technician, team and client (those booked on its appointments)."] },
    ],
  };
}
