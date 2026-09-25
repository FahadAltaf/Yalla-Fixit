"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * The client link, on screen, after it has been minted.
 *
 * It used to go to the clipboard and say so in a toast. A toast fades,
 * and the clipboard is one paste away from being overwritten -- so the
 * only way back to a link that had been lost was to mint another one,
 * which stops the link already sent to the client working. Here it stays
 * until it is dismissed, and can be copied again as often as needed.
 */
export function AmcLinkDialog({
  link,
  onClose,
}: {
  link: { label: string; url: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      // Back to "Copy" after a moment, so the button stays usable.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <Dialog
      open={Boolean(link)}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="text-brand size-4" />
            {link ? `${link.label === "proposal" ? "Proposal" : "Contract"} link` : "Link"}
          </DialogTitle>
          <DialogDescription>
            Send this to the client over WhatsApp or email. Getting another
            link later stops this one working, so keep this one until it has
            been sent.
          </DialogDescription>
        </DialogHeader>

        {/*
          Read-only rather than disabled: the text has to stay selectable
          for somebody whose browser refuses clipboard access.
        */}
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={link?.url ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
            aria-label="Client link"
          />
          <Button variant="outline" onClick={() => void copy()} className="shrink-0">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <DialogFooter>
          {link ? (
            <Button asChild variant="outline">
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                Open it
              </a>
            </Button>
          ) : null}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
