"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { amcSettingsService } from "@/modules/amc-submissions";

import { AMC_SERVICES } from "./amc-constants";
import {
  getAmcSettingsDefaults,
  type AmcSettings,
  type AmcSettingsOverrides,
} from "./amc-settings";

/**
 * AMC Settings (FR6.1–FR6.5).
 *
 * Admin-only. The API enforces that; this page also checks, so a
 * non-admin sees an explanation instead of a form that will 403 on save.
 *
 * Each field shows the live value and is marked Customised when it differs
 * from the shipped default, with a Reset that removes the override rather
 * than pasting the default text in — so the clause goes back to tracking
 * releases instead of being frozen at whatever the default said today.
 */

const CLAUSE_FIELDS = [
  {
    key: "emergencyCallOut" as const,
    label: "Clause 3.1 — Emergency call-out",
    hint: "What counts as an emergency, and the response commitment.",
  },
  {
    key: "nonEmergencyCallOut" as const,
    label: "Clause 3.2 — Non-emergency call-out",
    hint: "What a non-emergency visit covers.",
  },
  {
    key: "materials" as const,
    label: "Clause 4 — Materials, spare parts and labour",
    hint: "What is consumable and covered, and what is chargeable.",
  },
  {
    key: "servicesExcluded" as const,
    label: "Clause 5 — Services excluded",
    hint: "Everything outside the scope of an AMC.",
  },
  {
    key: "termination" as const,
    label: "Clause 8 — Termination",
    hint: "Notice period and refund terms.",
  },
];

function isCustomised(value: string, fallback: string) {
  return value !== fallback;
}

export function AmcSettingsPage() {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.roles?.name === "admin";

  const defaults = useMemo(() => getAmcSettingsDefaults(), []);
  const [settings, setSettings] = useState<AmcSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await amcSettingsService.getSettings();
      setSettings(response.settings);
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
      toast.error(
        error instanceof Error ? error.message : "Failed to load AMC settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else setLoading(false);
  }, [isAdmin, load]);

  const patch = (next: Partial<AmcSettings>) =>
    setSettings((current) => (current ? { ...current, ...next } : current));

  /*
    Only what differs from the shipped default is sent. A clause left
    alone stays absent from the override document, so a later release that
    corrects it still reaches this install.
  */
  const buildOverrides = (current: AmcSettings): AmcSettingsOverrides => {
    const clauses = Object.fromEntries(
      CLAUSE_FIELDS.map(({ key }) => [key, current.clauses[key]]).filter(
        ([key, value]) =>
          isCustomised(value as string, defaults.clauses[key as keyof AmcSettings["clauses"]]),
      ),
    );

    const serviceScopes = Object.fromEntries(
      Object.entries(current.serviceScopes).filter(([id, text]) =>
        isCustomised(text, defaults.serviceScopes[id] ?? ""),
      ),
    );

    const providerChanged =
      current.provider.contactNo !== defaults.provider.contactNo ||
      current.provider.coordinationEmails.join("|") !==
        defaults.provider.coordinationEmails.join("|");

    return {
      ...(providerChanged ? { provider: current.provider } : {}),
      ...(Object.keys(clauses).length ? { clauses } : {}),
      ...(Object.keys(serviceScopes).length ? { serviceScopes } : {}),
    };
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await amcSettingsService.saveSettings(
        buildOverrides(settings),
      );
      setSettings(response.settings);
      toast.success(
        response.changedKeys?.length
          ? `Saved. ${response.changedKeys.length} field${response.changedKeys.length === 1 ? "" : "s"} updated — new proposals will use this text.`
          : "Saved. Nothing had changed.",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save AMC settings",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5" />}
        title="Administrators only"
        description="AMC Settings holds the standard text every proposal and contract is written from, so only an administrator can change it. Ask an admin if a clause needs updating."
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-52" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (loadFailed || !settings) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5" />}
        title="Couldn't load AMC settings"
        description="The request failed. This is usually temporary — try again in a moment."
        action={{ label: "Try again", onClick: () => void load() }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AMC Settings</h2>
          <p className="text-muted-foreground text-sm">
            The standard text and values both documents are built from.
            Changes apply to new proposals — anything already sent keeps the
            text it was sent with.
          </p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save changes
        </Button>
      </div>

      {/* FR6.3 — the last two §8.2 placeholders. Until these are filled in,
          every contract still prints the XXX they shipped with. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Standard values</CardTitle>
          <p className="text-muted-foreground text-sm">
            Printed on every contract.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amc-contact-no">Contact numbers</Label>
            <Input
              id="amc-contact-no"
              value={settings.provider.contactNo}
              onChange={(event) =>
                patch({
                  provider: {
                    ...settings.provider,
                    contactNo: event.target.value,
                  },
                })
              }
            />
          </div>
          {settings.provider.coordinationEmails.map((email, index) => (
            <div key={index} className="space-y-2">
              <Label htmlFor={`amc-coordination-email-${index}`}>
                Coordination email {index + 1}
              </Label>
              <Input
                id={`amc-coordination-email-${index}`}
                value={email}
                onChange={(event) => {
                  const next = [...settings.provider.coordinationEmails];
                  next[index] = event.target.value;
                  patch({
                    provider: { ...settings.provider, coordinationEmails: next },
                  });
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* FR6.2 — clause text. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contract clauses</CardTitle>
          <p className="text-muted-foreground text-sm">
            Leave a clause untouched and it keeps tracking product updates.
            Edit it and this text is used instead.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {CLAUSE_FIELDS.map(({ key, label, hint }) => {
            const customised = isCustomised(
              settings.clauses[key],
              defaults.clauses[key],
            );
            return (
              <div key={key} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={`amc-clause-${key}`}>{label}</Label>
                  {customised && (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Customised</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          patch({
                            clauses: {
                              ...settings.clauses,
                              [key]: defaults.clauses[key],
                            },
                          })
                        }
                      >
                        <RotateCcw className="size-3" />
                        Reset
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">{hint}</p>
                <Textarea
                  id={`amc-clause-${key}`}
                  rows={6}
                  value={settings.clauses[key]}
                  onChange={(event) =>
                    patch({
                      clauses: { ...settings.clauses, [key]: event.target.value },
                    })
                  }
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* FR6.2 — "the scope of work for each service". */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Service scope of work</CardTitle>
          <p className="text-muted-foreground text-sm">
            What each service covers, as printed in the contract.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {AMC_SERVICES.map((service) => {
            const value = settings.serviceScopes[service.id] ?? "";
            const customised = isCustomised(
              value,
              defaults.serviceScopes[service.id] ?? "",
            );
            return (
              <div key={service.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={`amc-scope-${service.id}`}>
                    {service.label}
                  </Label>
                  {customised && (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Customised</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          patch({
                            serviceScopes: {
                              ...settings.serviceScopes,
                              [service.id]:
                                defaults.serviceScopes[service.id] ?? "",
                            },
                          })
                        }
                      >
                        <RotateCcw className="size-3" />
                        Reset
                      </Button>
                    </div>
                  )}
                </div>
                <Textarea
                  id={`amc-scope-${service.id}`}
                  rows={5}
                  value={value}
                  onChange={(event) =>
                    patch({
                      serviceScopes: {
                        ...settings.serviceScopes,
                        [service.id]: event.target.value,
                      },
                    })
                  }
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
