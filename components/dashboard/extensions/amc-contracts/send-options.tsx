"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Download, ExternalLink, Link as LinkIcon, Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SEND_CHANNELS, type SendChannel, type SendResult } from "@/lib/amc/send-channels";
import { formatPhone } from "@/lib/phone/format-phone";
import { cn } from "@/lib/utils";

import { MessageText, errorText } from "./call-out-shared";

/*
  Sending anything to the client (17 Nov 2026): the same three ways
  everywhere -- WhatsApp, Email, Copy link. Email goes from the portal;
  WhatsApp and Copy link hand the coordinator the message or the link.
*/

/** Who it goes to. undefined: not known here (the server uses what is on file); null: nothing on file. */
export type SendContacts = { email?: string | null; phone?: string | null };

const channelLabel = (c: SendChannel, hasLink: boolean) => (c === "whatsapp" ? "WhatsApp" : c === "email" ? "Email" : hasLink ? "Copy link" : "Copy text");
const CHANNEL_ICON = { whatsapp: MessageCircle, email: Mail, link: LinkIcon } as const;

export async function copyToClipboard(text: string, done = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
    return true;
  } catch {
    toast.error("Could not copy. Select the text and copy it yourself.");
    return false;
  }
}

/*
  Each way as a card (25 Nov 2026, the user: the pill toggle and the big
  button looked rough): an icon, the way, and where it goes (the number or
  address on file). Neutral cards, the chosen one outlined; only WhatsApp's
  icon carries its own colour.
*/
const CHANNEL_TILE: Record<SendChannel, string> = {
  whatsapp: "bg-[#25d366]/12 text-[#1da851] dark:text-[#25d366]",
  email: "bg-muted text-foreground",
  link: "bg-muted text-foreground",
};

function channelHint(c: SendChannel, contacts: SendContacts, hasLink: boolean): string {
  if (c === "whatsapp") return contacts.phone ? formatPhone(contacts.phone) || contacts.phone : contacts.phone === null ? "No mobile on file" : "Message to send";
  if (c === "email") return contacts.email ? contacts.email : contacts.email === null ? "No email on file" : "From the portal";
  return hasLink ? "A link to paste" : "Text to paste";
}

/** The three ways, as a choice of cards. */
export function SendChannelToggle({
  value,
  onChange,
  channels = SEND_CHANNELS,
  hasLink = true,
  disabled,
  contacts = {},
}: {
  value: SendChannel;
  onChange: (c: SendChannel) => void;
  channels?: readonly SendChannel[];
  hasLink?: boolean;
  disabled?: boolean;
  /** Shown under each way: the number or address it goes to. */
  contacts?: SendContacts;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Send by"
      className={cn("grid gap-2", channels.length === 3 ? "sm:grid-cols-3" : channels.length === 2 ? "sm:grid-cols-2" : "")}
    >
      {channels.map((c) => {
        const Icon = CHANNEL_ICON[c];
        const on = value === c;
        const missing = (c === "email" && contacts.email === null) || (c === "whatsapp" && contacts.phone === null);
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cn(
              "bg-card relative flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              on ? "border-primary ring-primary/20 ring-2" : "hover:bg-muted/40",
            )}
          >
            {/* Stacked (25 Nov 2026): the icon and the tick, then the way and where it goes, so a narrow card cuts nothing. */}
            <span className="flex w-full items-center justify-between gap-2">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", CHANNEL_TILE[c])}>
                <Icon className="size-4" />
              </span>
              {on ? <Check className="text-primary size-4 shrink-0" aria-hidden /> : null}
            </span>
            <span className="grid w-full min-w-0 gap-0.5">
              <span className="text-sm leading-tight font-medium">{channelLabel(c, hasLink)}</span>
              <span className={cn("line-clamp-2 text-xs break-words", missing ? "text-warning" : "text-muted-foreground")} title={channelHint(c, contacts, hasLink)}>
                {channelHint(c, contacts, hasLink)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What the chosen way does, in one line. */
export function SendChannelNote({
  channel,
  contacts,
  hasLink = true,
  what,
  attach = false,
  className,
}: {
  channel: SendChannel;
  contacts: SendContacts;
  hasLink?: boolean;
  what: string;
  /** A document the coordinator attaches to the WhatsApp message (no link in the text). */
  attach?: boolean;
  className?: string;
}) {
  const { email, phone } = contacts;
  const text =
    channel === "whatsapp"
      ? phone
        ? `Prepares the message for ${formatPhone(phone) || phone}; you send it from WhatsApp${attach ? `, with ${what} attached (Download PDF)` : ""}.`
        : phone === null
          ? `No mobile number on file: the message is prepared for you to copy into WhatsApp${attach ? `, with ${what} attached` : ""}.`
          : `Prepares the message; you send it from WhatsApp${attach ? `, with ${what} attached (Download PDF)` : ""}.`
      : channel === "email"
        ? email
          ? `Emails ${what} to ${email}.`
          : email === null
            ? "No email address on file: pick WhatsApp or copy instead."
            : `Emails ${what} to the client's address on file.`
        : hasLink
          ? `Creates the link to ${what} and copies it, to paste in any chat.`
          : "Copies the message, to paste in any chat.";
  return <p className={cn("text-xs", channel === "email" && email === null ? "text-warning" : "text-muted-foreground", className)}>{text}</p>;
}

/**
 * A document to attach by hand (18 Nov 2026): WhatsApp texts carry no link,
 * so the coordinator downloads the file and attaches it. `SendDownload`
 * builds and saves it (the branded PDF, as the viewer shows it); without
 * one, the stored file in the result is downloaded.
 */
export type SendDownload = () => Promise<void>;

async function downloadStoredFile(file: { url: string; name: string }) {
  try {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    /* Open it instead: the browser saves or shows it. */
    window.open(file.url, "_blank", "noopener,noreferrer");
  }
}

function DownloadFileButton({ result, download }: { result: SendResult; download?: SendDownload }) {
  const [busy, setBusy] = useState(false);
  const run = download ?? (result.file ? () => downloadStoredFile(result.file!) : null);
  if (!run) return null;
  const pdf = download ? true : /\.pdf$/i.test(result.file?.name ?? "");
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await run();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {pdf ? "Download PDF" : "Download file"}
    </Button>
  );
}

/** After WhatsApp or Copy link: the message, the file to attach, the link and the buttons to send or copy them. */
export function SendResultView({ channel, result, download }: { channel: SendChannel; result: SendResult; download?: SendDownload }) {
  const attach = Boolean(download || result.file);
  if (channel === "link" && result.link) {
    return (
      <div className="grid gap-3">
        <div className="flex gap-2">
          <Input readOnly value={result.link} aria-label="Link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button variant="outline" onClick={() => void copyToClipboard(result.link!, "Link copied")}>
            <Copy className="size-4" />
            Copy link
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">Anyone with the link can open it: share it only with the client. It works for 14 days.</p>
        {result.message ? (
          <div className="bg-muted/30 grid gap-2 rounded-lg border px-4 py-3">
            <p className="text-muted-foreground text-xs">Or the whole message</p>
            <MessageText text={result.message} />
            <Button size="sm" variant="outline" className="w-fit" onClick={() => void copyToClipboard(result.message, "Message copied")}>
              <Copy className="size-3.5" />
              Copy message
            </Button>
          </div>
        ) : null}
        {attach ? (
          <div className="flex flex-wrap items-center gap-2">
            <DownloadFileButton result={result} download={download} />
            <span className="text-muted-foreground text-xs">To send the file itself instead of the link.</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="bg-muted/30 rounded-lg border px-4 py-3">
        <MessageText text={result.message} />
      </div>
      {channel === "whatsapp" && !result.whatsapp ? <p className="text-warning text-xs">No mobile number on file: copy the message and send it yourself.</p> : null}
      {attach ? <p className="text-muted-foreground text-xs">Download the PDF, then attach it to the message in WhatsApp.</p> : null}
      <div className="flex flex-wrap gap-2">
        <DownloadFileButton result={result} download={download} />
        {channel === "whatsapp" && result.whatsapp ? (
          <Button asChild>
            <a href={result.whatsapp} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Open WhatsApp
            </a>
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => void copyToClipboard(result.message, "Message copied")}>
          <Copy className="size-4" />
          Copy text
        </Button>
      </div>
    </div>
  );
}

/**
 * Says how an email went. Returns true when there is something left for the
 * coordinator to send (WhatsApp, Copy link), which the caller then shows.
 */
export function announceSend(channel: SendChannel, result: SendResult, noun: string): boolean {
  if (channel !== "email") {
    if (channel === "link") void copyToClipboard(result.link ?? result.message, result.link ? "Link copied" : "Message copied");
    return true;
  }
  if (result.outcome === "sent") toast.success(`${noun} emailed`);
  else if (result.outcome === "no_recipient") toast.warning("No email address on file: send it by WhatsApp or copy the link.");
  else toast.error("The email could not be sent. Try again, or send it by WhatsApp or copy the link.");
  return false;
}

const actionLabel = (c: SendChannel, hasLink: boolean) => (c === "email" ? "Send email" : c === "whatsapp" ? "Prepare message" : hasLink ? "Create link" : "Copy text");
const ActionIcon = ({ c }: { c: SendChannel }) => (c === "email" ? <Send className="size-4" /> : c === "whatsapp" ? <MessageCircle className="size-4" /> : <LinkIcon className="size-4" />);

const firstChannel = (channels: readonly SendChannel[], contacts: SendContacts, preferred?: SendChannel): SendChannel =>
  preferred && channels.includes(preferred) ? preferred : channels.includes("email") && contacts.email !== null ? "email" : channels.includes("whatsapp") ? "whatsapp" : channels[0];

/**
 * The send dialog: pick the way, send, then (for WhatsApp or Copy link) the
 * message and link to send yourself. `children` adds fields under the
 * choice (an address, a note).
 */
export function SendDialog({
  open,
  onOpenChange,
  title,
  description,
  what,
  noun,
  contacts = {},
  channels = SEND_CHANNELS,
  hasLink = true,
  defaultChannel,
  children,
  canSend = true,
  onSend,
  onDone,
  download,
  attach = Boolean(download),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** "the service report": used in the notes. */
  what: string;
  /** "Service report": used in the toasts. */
  noun: string;
  contacts?: SendContacts;
  channels?: readonly SendChannel[];
  hasLink?: boolean;
  defaultChannel?: SendChannel;
  children?: ReactNode | ((channel: SendChannel) => ReactNode);
  /** False while a field in `children` is not ready (for the channel given). */
  canSend?: boolean | ((channel: SendChannel) => boolean);
  onSend: (channel: SendChannel) => Promise<SendResult>;
  /** After it was sent or prepared (refresh the page). */
  onDone?: () => void | Promise<void>;
  /** Builds and saves the document, for WhatsApp (else the stored file is downloaded). */
  download?: SendDownload;
  /** The document is attached to WhatsApp by hand (the note says so). */
  attach?: boolean;
}) {
  const [channel, setChannel] = useState<SendChannel>(() => firstChannel(channels, contacts, defaultChannel));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setChannel(firstChannel(channels, contacts, defaultChannel));
    }
    // Reset on opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async () => {
    setBusy(true);
    try {
      const r = await onSend(channel);
      const more = announceSend(channel, r, noun);
      await onDone?.();
      if (more) setResult(r);
      else onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e, `Could not send ${what}.`));
    } finally {
      setBusy(false);
    }
  };

  const emailBlocked = channel === "email" && contacts.email === null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? (channel === "whatsapp" ? "Send it on WhatsApp" : hasLink ? "The link is ready" : "The message is ready") : title}</DialogTitle>
          <DialogDescription>
            {result
              ? channel === "whatsapp"
                ? "Open WhatsApp to send the message as it is, or copy it."
                : hasLink
                  ? "Copied to your clipboard. Paste it in any chat with the client."
                  : "Copied to your clipboard. Paste it in any chat with the client."
              : (description ?? `Send ${what} to the client.`)}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <SendResultView channel={channel} result={result} download={download} />
        ) : (
          <div className="grid gap-3 py-1">
            <SendChannelToggle value={channel} onChange={setChannel} channels={channels} hasLink={hasLink} disabled={busy} contacts={contacts} />
            <SendChannelNote channel={channel} contacts={contacts} hasLink={hasLink} what={what} attach={attach} />
            {typeof children === "function" ? children(channel) : children}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <SubmitButton onClick={() => void send()} disabled={!(typeof canSend === "function" ? canSend(channel) : canSend) || emailBlocked} pending={busy} pendingLabel={channel === "email" ? "Sending…" : "Preparing…"} icon={<ActionIcon c={channel} />}>
                {actionLabel(channel, hasLink)}
              </SubmitButton>
            </>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** Only the second step, for a send that happened inside another action (closing a visit). */
export function SendResultDialog({
  sent,
  onClose,
  download,
}: {
  sent: { channel: SendChannel; result: SendResult; hasLink?: boolean } | null;
  onClose: () => void;
  download?: SendDownload;
}) {
  const hasLink = sent?.hasLink ?? true;
  return (
    <Dialog open={sent !== null} onOpenChange={(next) => !next && onClose()}>
      <ActionDialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sent?.channel === "whatsapp" ? "Send it on WhatsApp" : hasLink ? "The link is ready" : "The message is ready"}</DialogTitle>
          <DialogDescription>
            {sent?.channel === "whatsapp" ? "Open WhatsApp to send the message as it is, or copy it." : "Copied to your clipboard. Paste it in any chat with the client."}
          </DialogDescription>
        </DialogHeader>
        {sent ? <SendResultView channel={sent.channel} result={sent.result} download={download} /> : null}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** The choice and the button inline (inside another dialog), then what to send. */
export function SendInline({
  what,
  noun,
  contacts = {},
  channels = SEND_CHANNELS,
  hasLink = true,
  defaultChannel,
  onSend,
  onDone,
  download,
  attach = Boolean(download),
}: {
  what: string;
  noun: string;
  contacts?: SendContacts;
  channels?: readonly SendChannel[];
  hasLink?: boolean;
  defaultChannel?: SendChannel;
  onSend: (channel: SendChannel) => Promise<SendResult>;
  onDone?: (channel: SendChannel, result: SendResult) => void | Promise<void>;
  download?: SendDownload;
  attach?: boolean;
}) {
  const [channel, setChannel] = useState<SendChannel>(() => firstChannel(channels, contacts, defaultChannel));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const send = async () => {
    setBusy(true);
    try {
      const r = await onSend(channel);
      if (announceSend(channel, r, noun)) setResult(r);
      await onDone?.(channel, r);
    } catch (e) {
      toast.error(errorText(e, `Could not send ${what}.`));
    } finally {
      setBusy(false);
    }
  };
  if (result) return <SendResultView channel={channel} result={result} download={download} />;
  const emailBlocked = channel === "email" && contacts.email === null;
  return (
    <div className="grid gap-3">
      <SendChannelToggle value={channel} onChange={setChannel} channels={channels} hasLink={hasLink} disabled={busy} contacts={contacts} />
      {/* What happens, and the one action, on a line of their own. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
        <SendChannelNote channel={channel} contacts={contacts} hasLink={hasLink} what={what} attach={attach} className="min-w-0 flex-1 basis-56" />
        <SubmitButton size="sm" className="shrink-0" onClick={() => void send()} disabled={emailBlocked} pending={busy} pendingLabel={channel === "email" ? "Sending…" : "Preparing…"} icon={<ActionIcon c={channel} />}>
          {actionLabel(channel, hasLink)}
        </SubmitButton>
      </div>
    </div>
  );
}
