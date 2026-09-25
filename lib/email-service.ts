import { TODO_STATUS_LABELS, Todo } from "@/types/types";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";

interface EmailOptions {
  to?: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  attachment?: {
    filename: string;
    content: string; // base64-encoded
    contentType: string;
  };
}

export const emailService = {
  sendEmail: async ({ to, subject, html, cc, attachment }: EmailOptions) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ to, subject, html, cc, attachment }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : JSON.stringify(data?.error ?? data)
        );
      }

      return data;
    } catch (error) {
      console.error("Email send error:", error);
      throw error;
    }
  },


  /**
   * FR-6.07 — an approval that has run past its 48-hour window.
   *
   * Goes to the people named on the job (approval manager and reviewer)
   * rather than a fixed address, so escalation follows the assignment
   * instead of a hard-coded mailbox.
   */
  sendSnaggingEscalationEmail: async ({
    to,
    code,
    unit,
    status,
    waitingHours,
    jobUrl,
  }: {
    to: string[];
    code: string;
    unit: string;
    status: string;
    waitingHours: number;
    jobUrl: string;
  }) => {
    const subject = `Overdue approval — ${code} has been waiting ${waitingHours}h`;
    const html = clientEmailHtml({
      eyebrow: "Snagging",
      heading: "Approval overdue",
      paragraphs: [
        `The 48-hour approval window has passed on this inspection, and it is still waiting.`,
      ],
      details: [
        { label: "Inspection", value: code },
        { label: "Unit", value: unit },
        { label: "Status", value: status.replace(/_/g, " ") },
        { label: "Waiting", value: `${waitingHours} hours` },
      ],
      cta: { label: "Open the inspection", url: jobUrl },
      footnote:
        "You are receiving this because you are named as the reviewer or approval manager on this job.",
    });
    return emailService.sendEmail({ to, subject, html });
  },

  /**
   * FR-6.02 / FR-6.03 — work sent back to the inspector.
   *
   * Carries the category, the written reason and the remediation deadline,
   * because an inspector who only learns "rejected" has to open the app to
   * find out what to fix.
   */
  sendSnaggingRejectionEmail: async ({
    to,
    code,
    unit,
    categoryLabel,
    remediation,
    reason,
    dueAt,
    jobUrl,
  }: {
    to: string;
    code: string;
    unit: string;
    categoryLabel: string;
    remediation: string;
    reason: string;
    dueAt: string;
    jobUrl: string;
  }) => {
    /*
      The server cannot know the reader's time zone, so the deadline names
      the one it is given in rather than leaving the reader to guess.
    */
    const due = `${new Date(dueAt).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Dubai",
    })} (UAE time)`;
    const subject = `Sent back for correction — ${code} (${categoryLabel})`;
    const html = clientEmailHtml({
      eyebrow: "Snagging",
      heading: `${code} needs correcting`,
      paragraphs: [
        `Your inspection of <strong>${escapeEmailHtml(unit)}</strong> has been sent back as <strong>${escapeEmailHtml(categoryLabel)}</strong>. ${escapeEmailHtml(remediation)}.`,
        `<strong>Reason given</strong><br />${escapeEmailHtml(reason).replace(/\n/g, "<br />")}`,
      ],
      details: [
        { label: "Unit", value: unit },
        { label: "Sent back as", value: categoryLabel },
        { label: "Due back by", value: due },
      ],
      cta: { label: "Open the inspection", url: jobUrl },
    });
    return emailService.sendEmail({ to, subject, html });
  },

  sendPaymentConfirmationEmail: async ({
    email,
    name,
    buildingName,
    unitNumber,
    unitType,
    unitSize,
    totalAmount,
    includeAMC,
    includeInsurance,
  }: {
    email: string;
    name: string;
    buildingName: string;
    unitNumber: string;
    unitType: string;
    unitSize: string;
    totalAmount: number;
    includeAMC: boolean;
    includeInsurance: boolean;
  }) => {
    const subject = "Payment confirmation — property management service";
    const html = clientEmailHtml({
      eyebrow: "Property care",
      heading: "Payment received",
      greeting: name ? `Dear ${name},` : undefined,
      paragraphs: [
        "Thank you for choosing our property management service. Your payment has been received and your cover is being set up.",
      ],
      details: [
        { label: "Building", value: buildingName },
        { label: "Unit", value: unitNumber },
        { label: "Type", value: unitType },
        { label: "Size", value: unitSize },
        { label: "AMC", value: includeAMC ? "Included" : "Not included" },
        { label: "Insurance", value: includeInsurance ? "Included" : "Not included" },
        { label: "Total paid", value: `AED ${totalAmount.toLocaleString()}` },
      ],
      footnote: "Keep this email as your receipt. We will be in touch about scheduling.",
    });
    return emailService.sendEmail({ to: email, subject, html });
  },

  sendInviteEmail: async (email: string, inviteLink: string) => {
    const subject = "You have been invited to join Yalla Fix It";
    const html = clientEmailHtml({
      eyebrow: "Invitation",
      heading: "You have been invited",
      paragraphs: [
        "You have been invited to the Yalla Fix It portal. Set up your account to get started.",
      ],
      cta: { label: "Accept the invitation", url: inviteLink },
      footnote:
        "This link expires in 24 hours. If you were not expecting this invitation, ignore this email.",
    });
    return emailService.sendEmail({ to: email, subject, html });
  },

  sendTodoAssignedEmail: async (email: string, todo: Todo) => {
    const subject = `Todo assigned — ${todo.todo_key}`;
    const todoUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3032"}/todos?todo=${encodeURIComponent(todo.todo_key)}`;
    const html = clientEmailHtml({
      eyebrow: "Todos",
      heading: "A todo has been assigned to you",
      paragraphs: [escapeEmailHtml(todo.description || "No description given.")],
      details: [
        { label: "ID", value: todo.todo_key },
        { label: "Title", value: todo.title },
        { label: "Status", value: TODO_STATUS_LABELS[todo.status] },
        {
          label: "Deadline",
          value: new Date(todo.deadline_at).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Dubai",
          }),
        },
        ...(todo.related_type || todo.related_id
          ? [
              {
                label: "Related",
                value: `${todo.related_type ?? ""} ${todo.related_id ?? ""}`.trim(),
              },
            ]
          : []),
        ...(todo.tags.length
          ? [{ label: "Tags", value: todo.tags.join(", ") }]
          : []),
      ],
      cta: { label: "Open it", url: todoUrl },
    });

    return emailService.sendEmail({ to: email, subject, html });
  },

  sendTodoReminderEmail: async (emails: string[], todo: Todo) => {
    const subject = `Todo reminder — ${todo.todo_key}`;
    const todoUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3032"}/todos?todo=${encodeURIComponent(todo.todo_key)}`;
    const html = clientEmailHtml({
      eyebrow: "Todos",
      heading: "Reminder",
      paragraphs: [escapeEmailHtml(todo.description || "No description given.")],
      details: [
        { label: "ID", value: todo.todo_key },
        { label: "Title", value: todo.title },
        { label: "Status", value: TODO_STATUS_LABELS[todo.status] },
        {
          label: "Deadline",
          value: new Date(todo.deadline_at).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Dubai",
          }),
        },
        ...(todo.related_type || todo.related_id
          ? [
              {
                label: "Related",
                value: `${todo.related_type ?? ""} ${todo.related_id ?? ""}`.trim(),
              },
            ]
          : []),
      ],
      cta: { label: "Open it", url: todoUrl },
    });

    return emailService.sendEmail({ to: emails, subject, html });
  },
}; 
