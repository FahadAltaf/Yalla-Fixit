"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Link2, Loader2, MailX, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [ask, setAsk] = useState<{ targets: TechnicianLoginTarget[]; resolve: (ok: boolean) => void } | null>(null);
  const [shown, setShown] = useState<TechnicianLoginResult[] | null>(null);
  /* Kept across "Try again", so a login made before a failure is not made twice (its password would be lost). */
  const done = useRef(new Map<string, TechnicianLoginResult>());

  const createLogins = useCallback(async (targets: TechnicianLoginTarget[]): Promise<TechnicianLoginResult[] | null> => {
    if (!targets.length) return [];
    done.current = new Map();
    const ok = await new Promise<boolean>((resolve) => setAsk({ targets, resolve }));
    const made = done.current;
    if (!ok) {
      /* Cancelled after a partial batch: still show what was made, or those passwords are gone. */
      if (made.size) setShown([...made.values()]);
      return null;
    }
    technicianAccountsService.forget();
    usersService.forgetStaff();
    const results = targets.map((t) => made.get(t.fsmId)!).filter(Boolean);
    if (results.some((r) => r.status !== "existing")) setShown(results);
    return results;
  }, []);

  const run = useCallback(async () => {
    for (const t of ask?.targets ?? []) {
      if (done.current.has(t.fsmId)) continue;
      done.current.set(t.fsmId, await technicianAccountsService.createLogin(t.fsmId));
    }
  }, [ask]);

  const dialogs = (
    <>
      <CreateLoginDialog
        targets={ask?.targets ?? null}
        onCreate={run}
        onSettle={(ok) => {
          ask?.resolve(ok);
          setAsk(null);
        }}
      />
      <LoginDetailsDialog results={shown} onClose={() => setShown(null)} />
    </>
  );
  return { createLogins, dialogs };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * The question before a login is made (25 Nov 2026, the user: the plain
 * alert looked poor): who it is for, the email it uses, the role, and what
 * happens next. The logins are made while it stays open; a failure is
 * shown on it, so "Try again" never makes a login twice.
 */
function CreateLoginDialog({
  targets,
  onCreate,
  onSettle,
}: {
  targets: TechnicianLoginTarget[] | null;
  onCreate: () => Promise<void>;
  onSettle: (ok: boolean) => void;
}) {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const list = targets ?? [];
  const many = list.length > 1;
  const create = async () => {
    setFailure(null);
    setWorking(true);
    try {
      await onCreate();
      onSettle(true);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "The login could not be made. Try again.");
    } finally {
      setWorking(false);
    }
  };
  const close = () => {
    if (working) return;
    setFailure(null);
    onSettle(false);
  };
  return (
    <Dialog open={targets !== null} onOpenChange={(open) => (open ? null : close())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" onEscapeKeyDown={(e) => working && e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="bg-brand-50 text-brand border-brand/20 flex size-10 shrink-0 items-center justify-center rounded-lg border">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0 space-y-1 text-left">
              <DialogTitle>{many ? `Create ${list.length} mobile logins` : "Create a mobile login"}</DialogTitle>
              <DialogDescription>
                {many ? "These technicians have" : `${list[0]?.name ?? "This technician"} has`} no login yet, so they can&apos;t see this job in the YFI app.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ul className="divide-y overflow-hidden rounded-lg border">
          {list.map((t) => (
            <li key={t.fsmId} className="flex items-center gap-3 px-3 py-2.5">
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{initials(t.name)}</span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium">{t.name}</span>
                {t.email ? (
                  <span className="text-muted-foreground truncate font-mono text-xs" title={t.email}>
                    {t.email}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">Their email in Zoho FSM</span>
                )}
              </span>
              <Badge variant="secondary" className="shrink-0 border-0 font-medium">
                Inspector
              </Badge>
            </li>
          ))}
        </ul>

        <ol className="grid gap-2 text-sm">
          {[
            `${many ? "Each login uses the technician's" : "The login uses their"} email from Zoho FSM.`,
            "The Inspector role: the YFI mobile app and Snagging, nothing else.",
            `You get the ${many ? "passwords" : "password"} next, once, to hand over.`,
          ].map((step, i) => (
            <li key={step} className="flex items-start gap-2.5">
              <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">{i + 1}</span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>

        {failure ? (
          <p className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm" role="alert">
            {failure}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={working}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void create()} disabled={working}>
            {working ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {working ? "Creating…" : failure ? "Try again" : many ? "Create logins" : "Create login"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
  Who still needs a login, said the same way on every crew screen (25 Nov
  2026): a badge on the technician, a line above the list saying what
  adding them does, and nobody added whose login can't be made.
*/

/** The technician's badge: needs a login, or can't have one yet (no email in Zoho FSM). */
export function NeedsLoginBadge({ email, className }: { email: string | null | undefined; className?: string }) {
  if (email === null || email === "") {
    return (
      <Badge
        variant="outline"
        className={`border-danger/40 text-danger font-normal ${className ?? ""}`}
        title="No email in Zoho FSM, so no mobile login can be made. Add their email in FSM, then sync the technicians."
      >
        <MailX className="size-3" />
        No email in FSM
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`border-warning/40 text-warning font-normal ${className ?? ""}`}
      title="No mobile login yet: adding them creates one with their FSM email and the Inspector role"
    >
      <KeyRound className="size-3" />
      Needs login
    </Badge>
  );
}

/** Above the list: how many have no login, and what happens when one is added. */
export function NeedsLoginNote({ names }: { names: string[] }) {
  if (!names.length) return null;
  const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return (
    <p className="bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
      <KeyRound className="text-warning mt-0.5 size-3.5 shrink-0" />
      <span>
        <span className="text-foreground font-medium">{names.length === 1 ? "1 technician needs" : `${names.length} technicians need`} a mobile login</span> ({who}). Adding
        one to the job creates it first, with their Zoho FSM email and the Inspector role, and shows the password to hand over, so they see the job in the YFI app.
      </span>
    </p>
  );
}

/** A login can be made: they have an email in Zoho FSM. Says why not, else null. */
export function cannotRegister(t: { name: string; email?: string | null }): string | null {
  return t.email !== null && t.email !== "" ? null : `${t.name} has no email in Zoho FSM, so no mobile login can be made. Add their email in FSM, sync the technicians, then add them.`;
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
