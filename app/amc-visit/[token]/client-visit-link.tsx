"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { CalendarCheck, CalendarClock, CheckCircle2, Clock, FileUp, KeyRound, Link2Off, Loader2, MapPin, Phone, ShieldCheck, Wrench, X } from "lucide-react";

import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import CompanyLogo from "@/public/site-logo.webp";

type VisitView = {
  purpose: "visit_confirmation" | "access_upload";
  /** "AMC AMC-C-2026-0001 · Visit 3" or "Site visit ASM-2026-0001". */
  reference?: string;
  customerName: string;
  propertyLabel: string;
  contractNumber: string;
  visitNo: number;
  day: string;
  time: string | null;
  windowStart: string;
  windowEnd: string;
  services: string[];
  confirmed: boolean;
  status: string;
  passesNeeded: string[];
  lastResponse: { answer?: string; uploads?: number; preferredDate?: string | null } | null;
};

const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) => asDate(iso).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
const fmtDay = (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = (iso: string) => fmt(iso, { day: "numeric", month: "short" });
const todayInDubai = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong. Try again.");
  return body as T;
}

/**
 * The client's page for one AMC visit (22 Nov 2026), opened from the
 * message the coordinator sent: Confirm or ask for another date (DEV-507),
 * or upload the gate pass / work permit (DEV-494). No login.
 *
 * Redesigned 24 Nov 2026: the brand above the card, the visit as a
 * calendar tile with its time, window and services, the app's own date
 * picker for another date, a drop area for the pass, and the result shown
 * in the same card with the visit it is about.
 */
export function ClientVisitLink({ token }: { token: string }) {
  const url = `/api/amc-visit-link/${encodeURIComponent(token)}`;
  const [visit, setVisit] = useState<VisitView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; text: string; tone: "good" | "info" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"choose" | "reschedule">("choose");
  const [preferred, setPreferred] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(() => {
    call<{ visit: VisitView }>(url)
      .then((r) => setVisit(r.visit))
      .catch((e: Error) => setError(e.message));
  }, [url]);
  useEffect(load, [load]);

  const answer = async (kind: "confirm" | "reschedule") => {
    setProblem(null);
    if (name.trim().length < 2) return setProblem("Please write your name, so our team knows who answered.");
    setBusy(true);
    try {
      await call(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: kind, name: name.trim(), preferredDate: kind === "reschedule" && preferred ? preferred : null, note: note.trim() || null }),
      });
      setDone(
        kind === "confirm"
          ? { title: "Your visit is confirmed", text: "Thank you. Our team will see you then. If anything changes, reply to our message or call us.", tone: "good" }
          : {
              title: "We will call you",
              text: `Thank you. Our team will call you to agree another date${preferred ? `, from ${fmtDay(preferred)}` : ""}.`,
              tone: "info",
            },
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not save your answer.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    setProblem(null);
    if (name.trim().length < 2) return setProblem("Please write your name, so our team knows who sent it.");
    if (!file) return setProblem("Choose the pass or permit to upload.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", name.trim());
      if (note.trim()) form.append("note", note.trim());
      await call(url, { method: "POST", body: form });
      setDone({ title: "Pass received", text: "Thank you. Our team will check it before the visit and tell you if anything else is needed.", tone: "good" });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not upload the file.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <ResultCard tone="bad" icon={<Link2Off className="size-6" />} title="This link cannot be used" text={error} />
      </Shell>
    );
  }
  if (!visit) {
    return (
      <Shell>
        <div className="bg-card flex flex-col items-center gap-3 rounded-2xl border px-8 py-14 text-center shadow-sm">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
          <p className="text-muted-foreground text-sm">Loading your visit…</p>
        </div>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell>
        <ResultCard tone={done.tone} icon={done.tone === "good" ? <CheckCircle2 className="size-6" /> : <CalendarClock className="size-6" />} title={done.title} text={done.text}>
          <VisitSummary visit={visit} compact />
        </ResultCard>
      </Shell>
    );
  }

  const confirmation = visit.purpose === "visit_confirmation";
  return (
    <Shell>
      <article className="bg-card text-card-foreground overflow-hidden rounded-2xl border shadow-sm">
        <header className="space-y-2 border-b px-6 pt-6 pb-5 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-brand text-xs font-semibold tracking-wider uppercase">
              {visit.reference ?? `AMC ${visit.contractNumber} · Visit ${visit.visitNo}`}
            </p>
            {confirmation && visit.confirmed ? (
              <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
                <ShieldCheck className="size-3.5" />
                Confirmed
              </Badge>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{confirmation ? "Your maintenance visit" : "Gate pass for your visit"}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Dear {visit.customerName},{" "}
            {confirmation
              ? visit.confirmed
                ? "your visit is confirmed. If you need another date, ask below."
                : "please confirm the visit below, or ask for another date that suits you."
              : "please upload the pass or permit your building needs, so our team can get in on the day."}
          </p>
        </header>

        <div className="space-y-6 px-6 py-6 sm:px-8">
          <VisitSummary visit={visit} />

          {!confirmation && visit.passesNeeded.length ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <KeyRound className="text-muted-foreground size-4" />
              <span className="text-muted-foreground">Needed:</span>
              {visit.passesNeeded.map((p) => (
                <Badge key={p} variant="outline" className="font-normal">
                  {p}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="client-name">Your name</Label>
              <Input id="client-name" value={name} maxLength={120} autoComplete="name" placeholder="Your full name" onChange={(e) => setName(e.target.value)} />
            </div>

            {confirmation && mode === "reschedule" ? (
              <div className="bg-muted/40 grid gap-1.5 rounded-xl border p-4">
                <Label htmlFor="preferred">A date that suits you (optional)</Label>
                <DatePickerField id="preferred" value={preferred} minDate={todayInDubai()} placeholder="Pick a date" onChange={setPreferred} />
                <p className="text-muted-foreground text-xs">Our team will call you to agree the new date and time.</p>
              </div>
            ) : null}

            {!confirmation ? <FileDrop file={file} onFile={setFile} /> : null}

            <div className="grid gap-1.5">
              <Label htmlFor="client-note">
                Note for our team <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="client-note"
                rows={3}
                maxLength={500}
                value={note}
                placeholder={confirmation ? "For example: please call before you arrive" : "For example: the pass is valid from 9 am"}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {problem ? (
            <p className="border-danger/30 bg-danger/5 text-danger rounded-lg border px-3 py-2 text-sm" role="alert">
              {problem}
            </p>
          ) : null}
          {!confirmation && visit.lastResponse?.uploads ? (
            <p className="text-muted-foreground text-xs">
              You have already sent {visit.lastResponse.uploads} {visit.lastResponse.uploads === 1 ? "file" : "files"} on this link.
            </p>
          ) : null}

          {confirmation ? (
            mode === "choose" ? (
              <div className={cn("grid gap-3", !visit.confirmed && "sm:grid-cols-2")}>
                {!visit.confirmed ? (
                  <Button size="lg" disabled={busy} onClick={() => void answer("confirm")}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                    Confirm visit
                  </Button>
                ) : null}
                <Button size="lg" variant="outline" disabled={busy} onClick={() => setMode("reschedule")}>
                  <CalendarClock className="size-4" />
                  Ask for another date
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <Button size="lg" variant="ghost" disabled={busy} onClick={() => setMode("choose")}>
                  Back
                </Button>
                <Button size="lg" disabled={busy} onClick={() => void answer("reschedule")}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
                  Send my request
                </Button>
              </div>
            )
          ) : (
            <Button size="lg" className="w-full" disabled={busy} onClick={() => void upload()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              Upload the pass
            </Button>
          )}
        </div>
      </article>
    </Shell>
  );
}

/** The page around the card: the brand on top, the contact line below. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-muted/40 text-foreground flex min-h-screen flex-col items-center px-4 py-10 sm:py-14">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex justify-center">
          {/* The mark is dark ink: flattened to white on the dark theme, as in the sidebar. */}
          <Image src={CompanyLogo} alt="Yalla Fix It" width={150} height={150} className="h-auto w-[150px] dark:brightness-0 dark:invert" unoptimized priority />
        </div>
        {children}
        <footer className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs">
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5" />
            <a href="tel:+9718007373328" className="hover:text-foreground">
              +971 800 7373328
            </a>
          </span>
          <span aria-hidden>·</span>
          <span className="text-brand font-semibold">800-PERFECT</span>
          <span aria-hidden>·</span>
          <span>Yalla Fix It Facility Management</span>
        </footer>
      </div>
    </main>
  );
}

/** The visit: a calendar tile with its date, then when, where and what. */
function VisitSummary({ visit, compact = false }: { visit: VisitView; compact?: boolean }) {
  return (
    <div className={cn("bg-muted/40 grid gap-4 rounded-xl border p-4", !compact && "sm:p-5")}>
      <div className="flex items-center gap-4">
        <div className="bg-card flex w-16 shrink-0 flex-col items-center overflow-hidden rounded-xl border text-center shadow-xs">
          <span className="bg-brand w-full py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">{fmt(visit.day, { month: "short" })}</span>
          <span className="pt-1 text-2xl leading-none font-semibold tabular-nums">{fmt(visit.day, { day: "numeric" })}</span>
          <span className="text-muted-foreground pb-1.5 text-[11px]">{fmt(visit.day, { weekday: "short" })}</span>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{fmtDay(visit.day)}</p>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Clock className="size-3.5 shrink-0" />
            {visit.time ? `From ${visit.time}` : "Time to be agreed with you"}
          </p>
          {!compact && visit.windowStart && visit.windowEnd ? (
            <p className="text-muted-foreground text-xs">
              Service window {fmtShort(visit.windowStart)} – {fmtShort(visit.windowEnd)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2.5 border-t pt-3 text-sm">
        <p className="flex items-start gap-2">
          <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span>{visit.propertyLabel}</span>
        </p>
        {visit.services.length ? (
          <div className="flex items-start gap-2">
            <Wrench className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="flex flex-wrap gap-1.5">
              {visit.services.map((s) => (
                <Badge key={s} variant="secondary" className="font-normal">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A finished answer, or a link that cannot be used, in the same card style. */
function ResultCard({ tone, icon, title, text, children }: { tone: "good" | "info" | "bad"; icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <article className="bg-card text-card-foreground space-y-5 rounded-2xl border px-6 py-8 text-center shadow-sm sm:px-8">
      <div
        className={cn(
          "mx-auto flex size-14 items-center justify-center rounded-full",
          tone === "good" ? "bg-success/10 text-success" : tone === "bad" ? "bg-danger/10 text-danger" : "bg-brand/10 text-brand",
        )}
      >
        {icon}
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">{text}</p>
      </div>
      {children ? <div className="text-left">{children}</div> : null}
    </article>
  );
}

/** The pass: a drop area that says what is chosen, with a way to clear it. */
function FileDrop({ file, onFile }: { file: File | null; onFile: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="pass-file">The pass or permit</Label>
      <label
        htmlFor="pass-file"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
          over ? "border-brand bg-brand/5" : "hover:bg-muted/40",
        )}
      >
        <FileUp className="text-muted-foreground size-6" />
        {file ? (
          <span className="font-medium break-all">{file.name}</span>
        ) : (
          <>
            <span className="font-medium">Choose a file, or drop it here</span>
            <span className="text-muted-foreground text-xs">PDF or a photo (JPG, PNG, WebP)</span>
          </>
        )}
      </label>
      <input ref={input} id="pass-file" type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            onFile(null);
            if (input.current) input.current.value = "";
          }}
        >
          <X className="size-4" />
          Remove the file
        </Button>
      ) : null}
    </div>
  );
}
