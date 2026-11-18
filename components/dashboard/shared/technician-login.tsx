"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Link2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/dashboard/shared/kaizen-states";
import type { TechnicianLoginResult, TechnicianLoginTarget } from "@/lib/technician-accounts";
import { technicianAccountsService, type TechnicianAccountsList } from "@/modules/users/services/technician-accounts-service";
import { usersService } from "@/modules/users/services/users-service";

/**
 * Making a technician's mobile login before they are assigned (13 Nov 2026).
 *
 * `createLogins(technicians)` asks first (who, which email, which role),
 * creates or links each login while the question stays open, then shows
 * the email and the new password with copy buttons. It resolves to the
 * results (each with the portal user id), or null when cancelled.
 *
 * Used by the AMC crew list and the snagging inspector picker, so a login
 * is made, and handed over, the same way wherever somebody is assigned.
 */
export function useTechnicianLogins() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [shown, setShown] = useState<TechnicianLoginResult[] | null>(null);

  const createLogins = useCallback(
    async (targets: TechnicianLoginTarget[]): Promise<TechnicianLoginResult[] | null> => {
      if (!targets.length) return [];
      /* Kept across "Try again", so a login made before a failure is not asked for twice (its password would be lost). */
      const done = new Map<string, TechnicianLoginResult>();
      const one = targets.length === 1 ? targets[0] : null;
      const ok = await confirm({
        title: one ? `Create a login for ${one.name}?` : `Create logins for ${targets.length} technicians?`,
        description: one
          ? `${one.name} has no login yet, so they can't see this work on the mobile app. A login is created with their Zoho FSM email${one.email ? ` (${one.email})` : ""} and the Inspector role. You'll get the password next, to share with them.`
          : `${targets.map((t) => t.name).join(", ")} have no login yet, so they can't see this work on the mobile app. Each gets a login with their Zoho FSM email and the Inspector role. You'll get the passwords next, to share with them.`,
        confirmText: one ? "Create login" : "Create logins",
        action: async () => {
          for (const t of targets) {
            if (done.has(t.fsmId)) continue;
            done.set(t.fsmId, await technicianAccountsService.createLogin(t.fsmId));
          }
        },
      });
      if (!ok) {
        /* Cancelled after a partial batch: still show what was made, or those passwords are gone. */
        if (done.size) setShown([...done.values()]);
        return null;
      }
      technicianAccountsService.forget();
      usersService.forgetStaff();
      const results = targets.map((t) => done.get(t.fsmId)!).filter(Boolean);
      if (results.some((r) => r.status !== "existing")) setShown(results);
      return results;
    },
    [confirm],
  );

  const dialogs = (
    <>
      {confirmDialog}
      <LoginDetailsDialog results={shown} onClose={() => setShown(null)} />
    </>
  );
  return { createLogins, dialogs };
}

/** The list of technicians and their logins, for a picker; reloads after a login is made. */
export function useTechnicianAccounts() {
  const [list, setList] = useState<TechnicianAccountsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await technicianAccountsService.list();
      if (alive.current) setList(next);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : "Could not load the technicians");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  return { list, error, loading, reload: load };
}

/* ------------------------------------------------------------------ */

/*
  The clipboard API, else the older copy command: inside a dialog some
  browsers refuse the API (no permission, or not a secure origin), and a
  password nobody can copy is no help.
*/
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    /* Inside the open dialog, which keeps focus to itself. */
    (document.querySelector("[role=dialog]") ?? document.body).appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy refused");
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };
  return (
    <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => void copy()} aria-label={`Copy ${label}`}>
      {copied ? <Check className="text-success size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="text-muted-foreground w-16 shrink-0 text-xs">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-sm select-all">{value}</span>
      <CopyButton text={value} label={label.toLowerCase()} />
    </div>
  );
}

const STATUS: Record<TechnicianLoginResult["status"], { label: string; className: string }> = {
  created: { label: "New login", className: "bg-success/10 text-success" },
  linked: { label: "Existing account linked", className: "bg-brand-50 text-brand" },
  existing: { label: "Already had a login", className: "bg-muted text-muted-foreground" },
};

const detailsText = (results: TechnicianLoginResult[]) =>
  results
    .map((r) => [results.length > 1 ? r.name : null, `Email: ${r.email ?? "—"}`, r.password ? `Password: ${r.password}` : null].filter(Boolean).join("\n"))
    .join("\n\n");

/** The email and the new password, each with a copy button; the password is never shown again. */
function LoginDetailsDialog({ results, onClose }: { results: TechnicianLoginResult[] | null; onClose: () => void }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const list = results ?? [];
  const anyPassword = list.some((r) => r.password);
  const copyAll = async () => {
    try {
      await copyText(detailsText(list));
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };
  return (
    <Dialog open={results !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="bg-brand-50 text-brand border-brand/20 flex size-10 shrink-0 items-center justify-center rounded-lg border">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0 space-y-1 text-left">
              <DialogTitle>{list.length === 1 ? `Login ready for ${list[0].name}` : "Logins ready"}</DialogTitle>
              <DialogDescription>
                {anyPassword
                  ? "Share these with the technician to sign in to the mobile app. The password is shown only now, so copy it before closing."
                  : "They sign in to the mobile app with this email and the password they already have."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3">
          {list.map((r) => (
            <div key={r.fsmId} className="overflow-hidden rounded-lg border">
              <div className="bg-muted/30 flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="truncate text-sm font-medium">{r.name}</span>
                <Badge variant="secondary" className={`border-0 font-medium ${STATUS[r.status].className}`}>
                  {r.status === "linked" ? <Link2 className="size-3" /> : null}
                  {STATUS[r.status].label}
                </Badge>
              </div>
              <div className="divide-y">
                <CredentialRow label="Email" value={r.email ?? "—"} />
                {r.password ? <CredentialRow label="Password" value={r.password} /> : null}
              </div>
              {r.password ? null : (
                <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                  Uses their existing password. If they&apos;ve forgotten it, reset it under Users.
                </p>
              )}
            </div>
          ))}
        </div>

        {anyPassword ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Smartphone className="size-3.5 shrink-0" />
            New logins have the Inspector role: the mobile app and Snagging.
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => void copyAll()}>
            {copiedAll ? <Check className="text-success size-4" /> : <Copy className="size-4" />}
            {anyPassword ? "Copy email and password" : "Copy email"}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
