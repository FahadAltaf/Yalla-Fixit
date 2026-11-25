"use client";

import { useState } from "react";
import { BellRing, Play, Save } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState, FieldsSkeleton, SectionSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import {
  amcContractsService,
  type AmcNotificationSettings,
} from "@/modules/amc-contracts/amc-contracts-service";

import { useAmcData } from "./use-amc-data";
import { ModuleGuide } from "@/components/dashboard/extensions/amc-contracts/module-guide";

/**
 * AMC operations settings: notifications and reminders. Approvers edit. The
 * site visit checklist and the additional-service discount were taken off
 * (24 Nov 2026, the user: not used; the inspector builds the checklist on
 * the phone).
 */
export function AmcOpsSettings() {
  useBreadcrumbLabel("settings", "Operations settings");
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Configuration"
        title="Operations settings"
        info={<ModuleGuide module="opsSettings" />}
        description="Notifications and reminders. AMC proposal wording and prices stay in AMC Settings."
      />
      <AmcOpsSettingsSections />
    </div>
  );
}

/**
 * The operations settings themselves (24 Nov 2026): shown as the Operations
 * tab of AMC configuration, where they moved from their own menu entry.
 */
export function AmcOpsSettingsSections() {
  return (
    <>
      <NotificationSettings />
    </>
  );
}

/**
 * Who hears about what. Workflow emails go to people the workflow already
 * names (approvers, the proposal owner). Allowance emails and automatic
 * expiry reminders stay off until the business confirms recipients and a
 * schedule; the defaults are configuration, not a decision.
 */
function NotificationSettings() {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.notificationSettings(), "notification-settings");
  const [form, setForm] = useState<(AmcNotificationSettings & { thresholdsText: string; extraText: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  if (error) return <ErrorState title="Could not load the notification settings" message={error} onRetry={reload} />;
  if (loading || !data)
    return (
      <SectionSkeleton>
        <FieldsSkeleton fields={4} columns={2} />
      </SectionSkeleton>
    );
  const cfg = data.settings;
  const value = form ?? { ...cfg, thresholdsText: cfg.reminderThresholds.join(", "), extraText: cfg.reminderExtraEmails.join(", ") };
  const set = (patch: Partial<typeof value>) => setForm({ ...value, ...patch });
  const toggle = <T extends string>(list: T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));

  const save = async () => {
    setBusy(true);
    try {
      const next: AmcNotificationSettings = {
        workflowEmailEnabled: value.workflowEmailEnabled,
        entitlementEmailEnabled: value.entitlementEmailEnabled,
        reminderAutoEnabled: value.reminderAutoEnabled,
        reminderThresholds: value.thresholdsText
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
        reminderRecipients: value.reminderRecipients,
        reminderChannels: value.reminderChannels,
        reminderExtraEmails: value.extraText
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      };
      await amcContractsService.saveNotificationSettings(next);
      toast.success("Notification settings saved");
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  /* Asked first (11 Nov 2026): it acts at once, so it is confirmed like every other step. */
  const runRemindersCheck = () =>
    void confirm({ title: "Run the contract reminders now?", description: "Creates the expiry reminders that are due and sends them by the channels set below, as the daily run does. Reminders already sent are not sent again.", confirmText: "Run reminders" }).then((ok) => {
      if (ok) void runNow();
    });
  const runNow = async () => {
    setRunning(true);
    try {
      const r = await amcContractsService.runReminders();
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      toast.success(
        r.ran
          ? `Checked ${plural(r.contractsChecked, "contract")}: ${plural(r.remindersCreated, "new reminder")}.`
          : (r.reason ?? "Nothing to do."),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the reminders.");
    } finally {
      setRunning(false);
    }
  };

  const disabled = !data.canEdit;
  return (
    <SectionCard
      title="Notifications and reminders"
      description="Everyone gets AMC notifications in the portal (the bell at the top of each AMC page). Expiry reminders are not sent automatically until the business confirms the schedule, recipients and channels."
      icon={<BellRing />}
      bodyClassName="px-5 pb-5 grid gap-5"
    >
      <div className="grid gap-3">
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={value.workflowEmailEnabled} disabled={disabled} onCheckedChange={(v) => set({ workflowEmailEnabled: v })} aria-label="Workflow emails" />
          <span>
            <span className="font-medium">Workflow emails</span>
            <span className="text-muted-foreground block text-xs">
              Approvers when a proposal is submitted; the owner when it is approved or sent back, when the client answers or signs, and when the AMC is activated.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={value.entitlementEmailEnabled} disabled={disabled} onCheckedChange={(v) => set({ entitlementEmailEnabled: v })} aria-label="Allowance emails" />
          <span>
            <span className="font-medium">Allowance emails</span>
            <span className="text-muted-foreground block text-xs">
              Email the owner when a visits or hours allowance runs low (25% left) or out. Always shown in the portal.
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-3 border-t pt-4">
        <div className="text-sm font-medium">Contract expiry reminders</div>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={value.reminderAutoEnabled} disabled={disabled} onCheckedChange={(v) => set({ reminderAutoEnabled: v })} aria-label="Automatic reminders" />
          <span>
            <span className="font-medium">Send automatically</span>
            <span className="text-muted-foreground block text-xs">
              Off: reminders are created only when an approver runs them below. Business decision required before switching on.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rem-days">Days before the end date</Label>
            <Input id="rem-days" value={value.thresholdsText} disabled={disabled} placeholder="60, 30, 15" onChange={(e) => set({ thresholdsText: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rem-extra">Also email (optional)</Label>
            <Input id="rem-extra" value={value.extraText} disabled={disabled} placeholder="renewals@example.com" onChange={(e) => set({ extraText: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-muted-foreground">Recipients</span>
          {(["owner", "approvers"] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <Checkbox
                checked={value.reminderRecipients.includes(r)}
                disabled={disabled}
                onCheckedChange={(v) => set({ reminderRecipients: toggle(value.reminderRecipients, r, v === true) })}
              />
              {r === "owner" ? "Proposal owner" : "AMC approvers"}
            </label>
          ))}
          <span className="text-muted-foreground">Channels</span>
          {(["in_app", "email"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2">
              <Checkbox
                checked={value.reminderChannels.includes(c)}
                disabled={disabled}
                onCheckedChange={(v) => set({ reminderChannels: toggle(value.reminderChannels, c, v === true) })}
              />
              {c === "in_app" ? "In the portal" : "Email"}
            </label>
          ))}
        </div>
      </div>

      {data.canEdit ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <SubmitButton variant="outline" pending={running} pendingLabel="Running…" icon={<Play className="size-4" />} onClick={() => runRemindersCheck()} disabled={!!form}>
            Run reminders now
          </SubmitButton>
          <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} onClick={() => void save()} disabled={!form}>
            Save
          </SubmitButton>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Only AMC approvers can change this.</p>
      )}
      {confirmDialog}
    </SectionCard>
  );
}

