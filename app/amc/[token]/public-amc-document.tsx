"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSignature, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrencyAED } from "@/utils/format-currency";

/**
 * The client's view of a proposal or contract (FR5.5, FR5.7).
 *
 * Deliberately standalone: no dashboard chrome, no auth context, no
 * navigation. Whoever opens this has a link and nothing else, and every
 * control on the page is something they can actually do.
 */

type PublicDoc = {
  kind: "proposal" | "contract";
  status: string;
  proposalNumber: string | null;
  customerName: string | null;
  startDate: string | null;
  endDate: string | null;
  property: { propertyAddress?: string; propertyDetail?: string } | null;
  services: {
    serviceId: string;
    included: boolean;
    units: number;
    frequency: number;
    price?: number;
  }[];
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  clientDecision: string | null;
  signedByName: string | null;
  signedAt: string | null;
};

type Phase = "loading" | "ready" | "done" | "error";

export function PublicAmcDocument({ token }: { token: string }) {
  const [doc, setDoc] = useState<PublicDoc | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(`/api/amc/${token}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "This link is not available");
        setPhase("error");
        return;
      }
      const data = json.data as PublicDoc;
      setDoc(data);
      /* A document that has already been answered shows the outcome
         rather than the buttons — re-answering is not a thing. */
      setPhase(
        data.status === "proposal_sent" || data.status === "contract_sent"
          ? "ready"
          : "done",
      );
    } catch {
      setMessage("We could not load this document. Please try again.");
      setPhase("error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (
    action: "approve" | "reject" | "sign",
    payload: Record<string, string> = {},
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/amc/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: name.trim(), ...payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "We could not record your answer.");
        return;
      }
      setDoc(json.data as PublicDoc);
      setPhase("done");
    } catch {
      setMessage("We could not record your answer. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === "error" || !doc) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <XCircle className="text-destructive mx-auto size-8" />
            <p className="text-lg font-medium">{message ?? "Link unavailable"}</p>
            <p className="text-muted-foreground text-sm">
              If you think this is a mistake, reply to the email we sent and
              we will send you a new link.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const isContract = doc.kind === "contract";
  const included = doc.services.filter((row) => row.included);

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {isContract ? "Your AMC contract" : "Your AMC proposal"}
            {doc.proposalNumber ? ` — ${doc.proposalNumber}` : ""}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {doc.customerName ? `Prepared for ${doc.customerName}. ` : ""}
            {doc.property?.propertyAddress ?? ""}
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold">What is covered</h2>
            <ul className="divide-y rounded-md border text-sm">
              {included.map((row) => (
                <li
                  key={row.serviceId}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span>{prettyServiceId(row.serviceId)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {row.units} × {row.frequency}/yr
                  </span>
                </li>
              ))}
              {included.length === 0 && (
                <li className="text-muted-foreground px-3 py-2">
                  No services listed.
                </li>
              )}
            </ul>
          </div>

          <div className="space-y-1 text-sm">
            {doc.discountAmount > 0 && (
              <div className="text-muted-foreground flex justify-between">
                <span>Discount ({doc.discountPercent}%)</span>
                <span className="tabular-nums">
                  −{formatCurrencyAED(doc.discountAmount)}
                </span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatCurrencyAED(doc.finalPrice)}
              </span>
            </div>
          </div>

          <Separator />

          {phase === "done" ? (
            <Outcome doc={doc} />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="amc-name">
                  {isContract ? "Type your full name to sign" : "Your name"}
                </Label>
                <Input
                  id="amc-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                />
              </div>

              {rejecting && (
                <div className="space-y-2">
                  <Label htmlFor="amc-reason">What needs changing?</Label>
                  <Textarea
                    id="amc-reason"
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Tell us what to revise and we will send an updated proposal."
                  />
                </div>
              )}

              {message && (
                <p className="text-destructive text-sm" role="alert">
                  {message}
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {isContract ? (
                  <Button
                    className="sm:min-w-44"
                    disabled={busy || name.trim().length === 0}
                    onClick={() => void submit("sign")}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileSignature className="size-4" />
                    )}
                    Sign the contract
                  </Button>
                ) : rejecting ? (
                  <>
                    <Button
                      variant="destructive"
                      className="sm:min-w-40"
                      disabled={
                        busy ||
                        name.trim().length === 0 ||
                        reason.trim().length === 0
                      }
                      onClick={() =>
                        void submit("reject", { reason: reason.trim() })
                      }
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      Send back for changes
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setRejecting(false)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="sm:min-w-40"
                      disabled={busy || name.trim().length === 0}
                      onClick={() => void submit("approve")}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      Approve proposal
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setRejecting(true)}
                      disabled={busy}
                    >
                      Request changes
                    </Button>
                  </>
                )}
              </div>

              <p className="text-muted-foreground text-xs">
                {isContract
                  ? "Typing your name and signing records your agreement to this contract, with the date and time."
                  : "Your answer is recorded with the date and time. We will follow up either way."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

function Outcome({ doc }: { doc: PublicDoc }) {
  if (doc.status === "signed") {
    return (
      <Message
        tone="good"
        title="Signed — thank you"
        body={`Signed by ${doc.signedByName ?? "you"}${
          doc.signedAt ? ` on ${new Date(doc.signedAt).toLocaleDateString()}` : ""
        }. Your AMC is now in place and we will be in touch to schedule the first visit.`}
      />
    );
  }
  if (doc.status === "proposal_approved") {
    return (
      <Message
        tone="good"
        title="Proposal approved — thank you"
        body="We will prepare your contract and send it over for signature shortly."
      />
    );
  }
  if (doc.status === "proposal_rejected") {
    return (
      <Message
        tone="bad"
        title="Thank you for the feedback"
        body="We have passed your comments to the team and will send you a revised proposal."
      />
    );
  }
  return (
    <Message
      tone="neutral"
      title="Nothing to do right now"
      body="This document is not awaiting your answer. We will be in touch if anything is needed."
    />
  );
}

function Message({
  tone,
  title,
  body,
}: {
  tone: "good" | "bad" | "neutral";
  title: string;
  body: string;
}) {
  const Icon = tone === "bad" ? XCircle : CheckCircle2;
  const colour =
    tone === "good"
      ? "text-green-600"
      : tone === "bad"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="space-y-1 py-4 text-center">
      <Icon className={`mx-auto size-8 ${colour}`} />
      <p className="text-lg font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto max-w-prose text-sm">{body}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <p className="text-muted-foreground text-center text-xs tracking-wide uppercase">
          Yalla Fix It
        </p>
        {children}
      </div>
    </main>
  );
}

/* The catalogue lives behind the dashboard bundle, and this page is
   deliberately standalone, so the id is humanised rather than imported. */
function prettyServiceId(id: string): string {
  return id
    .split("-")
    .map((part) =>
      part === "ppm"
        ? "PPM"
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}
