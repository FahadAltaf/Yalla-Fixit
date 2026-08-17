"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { snaggingService } from "@/modules/snagging";
import { rejectTaskSchema, type RejectTaskInput } from "@/modules/snagging/schemas";
import type { SnaggingRejectionCategory } from "@/types/types";

import { REJECTION_RULES, REMEDIATION_SLA_HOURS } from "./shared";

/**
 * Rejection with the three-tier branching from §5.3.
 *
 * The category is presented with its remediation path and SLA rather
 * than as three bare words, because the difference between them is
 * whether a technician edits a field or drives back to site — and the
 * manager choosing is the one who decides that.
 */

const ORDER: SnaggingRejectionCategory[] = ["minor", "data_correction", "critical"];

export function RejectInspectionDialog({
  open,
  onOpenChange,
  taskId,
  onRejected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  onRejected?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<RejectTaskInput>({
    resolver: zodResolver(rejectTaskSchema),
    defaultValues: { category: "data_correction", comment: "" },
  });

  async function onSubmit(values: RejectTaskInput) {
    setSubmitting(true);
    try {
      await snaggingService.rejectTask(taskId, values);
      toast.success("Sent back to the inspector");
      onOpenChange(false);
      form.reset();
      onRejected?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send this back");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send this inspection back</DialogTitle>
          <DialogDescription>
            Every rejection is recorded in the audit log with its justification.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="gap-3"
                    >
                      {ORDER.map((category) => (
                        <label
                          key={category}
                          htmlFor={`reject-${category}`}
                          className="hover:bg-muted/50 has-[[data-state=checked]]:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3"
                        >
                          <RadioGroupItem
                            id={`reject-${category}`}
                            value={category}
                            className="mt-0.5"
                          />
                          <span className="space-y-0.5">
                            <span className="block font-medium">
                              {REJECTION_RULES[category].title}
                            </span>
                            <span className="text-muted-foreground block text-sm">
                              {REJECTION_RULES[category].description}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              {REJECTION_RULES[category].remediation} ·{" "}
                              {REMEDIATION_SLA_HOURS[category]}h SLA
                            </span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What needs fixing?</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="Photos for the two kitchen leak snags are blurry. Please retake sharp close-ups and re-submit."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={submitting}>
                {submitting ? "Sending…" : "Send back"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
