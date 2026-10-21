"use client";

import { useEffect, useState } from "react";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CustomServiceDraft = {
  customName: string;
  customScope: string;
};

/**
 * Names a service added to this proposal alone and writes its scope
 * (DEV-260). Units, frequency, price and equipment are entered on its row
 * in the table, like any other service.
 */
export function CustomServiceDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /* The service being edited; null adds a new one. */
  initial: CustomServiceDraft | null;
  onSave: (draft: CustomServiceDraft) => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.customName ?? "");
    setScope(initial?.customScope ?? "");
    setTried(false);
  }, [open, initial]);

  const missingName = !name.trim();

  const save = () => {
    setTried(true);
    if (missingName) return;
    onSave({ customName: name.trim(), customScope: scope.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit custom service" : "Add a custom service"}</DialogTitle>
          <DialogDescription>
            For a service that is not in the standard list, such as kitchen hood or grease trap
            cleaning. It applies to this proposal only, and prints as its own clause and its own
            row in the service frequency table.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="amc-custom-service-name">Service name</Label>
            <Input
              id="amc-custom-service-name"
              autoFocus
              maxLength={120}
              placeholder="e.g. Kitchen Hood Cleaning"
              value={name}
              aria-invalid={tried && missingName ? true : undefined}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                }
              }}
            />
            {tried && missingName ? (
              <p className="text-destructive text-sm">Give the service a name.</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="amc-custom-service-scope">Scope of work</Label>
            <Textarea
              id="amc-custom-service-scope"
              rows={6}
              maxLength={4000}
              placeholder={"Degreasing of hood, filters and ducting\nInspection of exhaust fan and belts"}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Each line prints as a point under the service&apos;s clause in the contract.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save}>
            {initial ? "Save" : "Add service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
