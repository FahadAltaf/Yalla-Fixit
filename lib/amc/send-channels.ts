import { z } from "zod";

/**
 * How something goes to the client (17 Nov 2026): every send in AMC offers
 * the same three ways.
 *
 *   whatsapp  the message is prepared (a document is downloaded and attached by hand); the coordinator sends it from WhatsApp
 *   email     the portal emails it (as before)
 *   link      the link (or, with no link, the message) is copied to paste anywhere
 *
 * Only "email" sends anything from the portal; the other two hand the text
 * to the coordinator. Automatic sends (reminders from the daily job) stay email.
 */
export const SEND_CHANNELS = ["whatsapp", "email", "link"] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];
export const sendChannelSchema = z.enum(SEND_CHANNELS);

/** sent / failed / no_recipient: an email. prepared: a WhatsApp message. link_created: a link or text to copy. */
export type SendOutcome = "sent" | "failed" | "no_recipient" | "prepared" | "link_created";

export interface SendResult {
  outcome: SendOutcome;
  /** The text for WhatsApp or to copy. */
  message: string;
  /** A wa.me link with the message, or null without a phone number on file. */
  whatsapp: string | null;
  /** The link to the document itself, when there is one. */
  link: string | null;
  /**
   * The document as a file to download (18 Nov 2026): WhatsApp texts carry
   * no link, so the coordinator downloads the PDF and attaches it.
   */
  file?: { url: string; name: string } | null;
}

/** The outcome before any email is tried: email starts as "no recipient" until it goes. */
export const initialOutcome = (channel: SendChannel): SendOutcome =>
  channel === "email" ? "no_recipient" : channel === "whatsapp" ? "prepared" : "link_created";

/** Whether it reached the client, or was handed to the coordinator to send. */
export const sendDelivered = (outcome: SendOutcome) => outcome !== "failed" && outcome !== "no_recipient";

/**
 * Whether the portal itself got it to the client (DEV-404, 20 Nov 2026
 * review): an email that went. A prepared WhatsApp text or a copied link
 * has not reached anyone yet, so it does not stop the service report's
 * clock; the coordinator marks the report sent once they sent it.
 */
export const reachedClient = (outcome: SendOutcome) => outcome === "sent";
