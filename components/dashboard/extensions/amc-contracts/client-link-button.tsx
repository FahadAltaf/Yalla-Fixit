"use client";

import { useState, type ReactNode } from "react";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { amcRequest } from "@/lib/amc/http-cache";

type Purpose = "visit_confirmation" | "access_upload";
type Channel = "whatsapp" | "email" | "sms";
type LinkResult = { url: string; expiresAt: string; message: string; whatsapp: string | null };

const COPY: Record<Purpose, { title: string; description: string }> = {
  visit_confirmation: {
    title: "Send the client a confirmation link",
    description: "The client opens it without a login and chooses Confirm or Reschedule. Their answer is saved on this visit and you are told. A new link replaces the last one.",
  },
  access_upload: {
    title: "Ask the client for the pass",
    description: "The client opens it without a login and uploads the gate pass or work permit. The file is kept on this visit (or site visit) and you are told, to check it and mark the access.",
  },
};

/**
 * A client link without a login for one visit (DEV-507 confirmation,
 * DEV-494 pass upload): pick how it is sent, make the link, then copy the
 * message or open WhatsApp with it.
 */
export function ClientLinkButton({
  visitId,
  siteVisitId,
  purpose,
  label,
  icon,
  disabled,
  variant = "outline",
  size,
}: {
  /** A planned visit's link. */
  visitId?: string;
  /** Or a site visit's (26 Nov 2026: the pass upload link on a site visit too). */
  siteVisitId?: string;
  purpose: Purpose;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  variant?: "outline" | "default";
  size?: "sm";
}) {
  const endpoint = siteVisitId
    ? `/api/amc-contracts/assessments/${encodeURIComponent(siteVisitId)}/client-link`
    : `/api/amc-visits/${encodeURIComponent(visitId ?? "")}/client-link`;
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);

  const make = async () => {
    setBusy(true);
    try {
      setResult(await amcRequest<LinkResult>(endpoint, { method: "POST", body: JSON.stringify({ purpose, channel }) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not make the link.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (what: "message" | "link") => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(what === "link" ? result.url : result.message);
      toast.success(what === "link" ? "Link copied" : "Message copied");
    } catch {
      toast.error("Could not copy: select the text and copy it.");
    }
  };

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => (setResult(null), setOpen(true))}>
        {icon}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <ActionDialogContent busy={busy} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{COPY[purpose].title}</DialogTitle>
            <DialogDescription>{COPY[purpose].description}</DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="grid gap-2 py-1">
              <Label htmlFor={`client-link-${purpose}`}>Message with the link</Label>
              <Textarea id={`client-link-${purpose}`} readOnly rows={5} value={result.message} />
              <Label htmlFor={`client-link-url-${purpose}`} className="pt-2">
                The link alone
              </Label>
              <input id={`client-link-url-${purpose}`} readOnly value={result.url} className="border-input bg-muted/40 h-9 w-full rounded-md border px-3 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <p className="text-muted-foreground text-xs">Works until {new Date(result.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</p>
            </div>
          ) : (
            <div className="grid gap-1.5 py-1">
              <Label>Sent by</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            {result ? (
              <>
                <Button variant="outline" onClick={() => void copy("message")}>
                  <Copy className="size-4" />
                  Copy message
                </Button>
                <Button variant="outline" onClick={() => void copy("link")}>
                  <Link2 className="size-4" />
                  Copy link
                </Button>
                {result.whatsapp ? (
                  <Button asChild>
                    <a href={result.whatsapp} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      Open WhatsApp
                    </a>
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton pending={busy} pendingLabel="Making…" icon={<Link2 className="size-4" />} onClick={() => void make()}>
                  Make the link
                </SubmitButton>
              </>
            )}
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </>
  );
}
